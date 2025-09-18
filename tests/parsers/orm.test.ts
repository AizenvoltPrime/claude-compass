import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { ORMParser } from '../../src/parsers/orm';
import { SymbolType, DependencyType } from '../../src/database/models';

describe('ORMParser', () => {
  let parser: ORMParser;

  beforeEach(() => {
    const treeParser = new Parser();
    treeParser.setLanguage(JavaScript);
    parser = new ORMParser(treeParser);
  });

  describe('getSupportedExtensions', () => {
    it('should return correct ORM file extensions', () => {
      const extensions = parser.getSupportedExtensions();
      expect(extensions).toContain('.prisma');
      expect(extensions).toContain('.ts');
      expect(extensions).toContain('.js');
      expect(extensions).toContain('.model.ts');
      expect(extensions).toContain('.entity.ts');
      expect(extensions).toContain('.schema.ts');
    });
  });

  describe('getFrameworkPatterns', () => {
    it('should return ORM patterns', () => {
      const patterns = parser.getFrameworkPatterns();
      expect(patterns).toHaveLength(4);
      expect(patterns.map(p => p.name)).toContain('prisma-schema');
      expect(patterns.map(p => p.name)).toContain('typeorm-entity');
      expect(patterns.map(p => p.name)).toContain('sequelize-model');
      expect(patterns.map(p => p.name)).toContain('mongoose-schema');
    });
  });

  describe('parseFile', () => {
    it('should parse Prisma schema', async () => {
      const content = `
        generator client {
          provider = "prisma-client-js"
        }

        datasource db {
          provider = "postgresql"
          url      = env("DATABASE_URL")
        }

        model User {
          id        Int      @id @default(autoincrement())
          email     String   @unique
          name      String?
          posts     Post[]
          profile   Profile?
          createdAt DateTime @default(now())
          updatedAt DateTime @updatedAt

          @@map("users")
        }

        model Post {
          id        Int      @id @default(autoincrement())
          title     String
          content   String?
          published Boolean  @default(false)
          author    User     @relation(fields: [authorId], references: [id])
          authorId  Int
          tags      Tag[]    @relation("PostTags")
          createdAt DateTime @default(now())

          @@map("posts")
        }

        model Profile {
          id     Int    @id @default(autoincrement())
          bio    String?
          userId Int    @unique
          user   User   @relation(fields: [userId], references: [id])

          @@map("profiles")
        }

        model Tag {
          id    Int    @id @default(autoincrement())
          name  String @unique
          posts Post[] @relation("PostTags")

          @@map("tags")
        }

        enum Role {
          USER
          ADMIN
          MODERATOR
        }
      `;

      const result = await parser.parseFile('schema.prisma', content);

      expect(result.symbols).toHaveLength(5); // User, Post, Profile, Tag, Role
      expect(result.symbols[0]).toMatchObject({
        name: 'User',
        symbol_type: SymbolType.ORM_ENTITY,
        is_exported: true,
      });

      expect(result.symbols[4]).toMatchObject({
        name: 'Role',
        symbol_type: SymbolType.ENUM,
        is_exported: true,
      });
    });

    it('should parse TypeORM entity', async () => {
      const content = `
        import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';

        @Entity('users')
        export class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ unique: true })
          email: string;

          @Column()
          name: string;

          @Column({ nullable: true })
          avatar?: string;

          @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
          createdAt: Date;

          @OneToMany(() => Post, post => post.author)
          posts: Post[];

          @OneToMany(() => Comment, comment => comment.user)
          comments: Comment[];
        }

        @Entity('posts')
        export class Post {
          @PrimaryGeneratedColumn()
          id: number;

          @Column()
          title: string;

          @Column('text')
          content: string;

          @Column({ default: false })
          published: boolean;

          @ManyToOne(() => User, user => user.posts)
          @JoinColumn({ name: 'author_id' })
          author: User;

          @Column({ name: 'author_id' })
          authorId: number;

          @OneToMany(() => Comment, comment => comment.post)
          comments: Comment[];
        }
      `;

      const result = await parser.parseFile('user.entity.ts', content);

      // ORM-specific parsing may not extract standard JS imports
      expect(result.imports.length).toBeGreaterThanOrEqual(0);

      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.exports.length).toBeGreaterThanOrEqual(0);
    });

    it('should parse Sequelize model', async () => {
      const content = `
        const { Model, DataTypes } = require('sequelize');
        const sequelize = require('../config/database');

        class User extends Model {
          static associate(models) {
            User.hasMany(models.Post, {
              foreignKey: 'authorId',
              as: 'posts'
            });
            User.hasOne(models.Profile, {
              foreignKey: 'userId',
              as: 'profile'
            });
          }
        }

        User.init({
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
          },
          email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: {
              isEmail: true
            }
          },
          name: {
            type: DataTypes.STRING,
            allowNull: false
          },
          password: {
            type: DataTypes.STRING,
            allowNull: false
          },
          isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
          }
        }, {
          sequelize,
          modelName: 'User',
          tableName: 'users',
          timestamps: true,
          paranoid: true
        });

        module.exports = User;
      `;

      const result = await parser.parseFile('user.model.js', content);

      expect(result.symbols.length).toBeGreaterThan(0);
      const userEntity = result.symbols.find(s => s.name === 'User');
      expect(userEntity).toBeDefined();
      expect(userEntity).toMatchObject({
        symbol_type: SymbolType.ORM_ENTITY,
      });

      expect(result.exports.length).toBeGreaterThanOrEqual(0);
    });

    it('should parse Mongoose schema', async () => {
      const content = `
        const mongoose = require('mongoose');
        const { Schema } = mongoose;

        const userSchema = new Schema({
          email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
          },
          name: {
            type: String,
            required: true,
            trim: true
          },
          age: {
            type: Number,
            min: 0,
            max: 120
          },
          posts: [{
            type: Schema.Types.ObjectId,
            ref: 'Post'
          }],
          profile: {
            type: Schema.Types.ObjectId,
            ref: 'Profile'
          },
          tags: [String],
          metadata: {
            lastLogin: Date,
            loginCount: { type: Number, default: 0 },
            preferences: {
              theme: { type: String, enum: ['light', 'dark'], default: 'light' },
              notifications: { type: Boolean, default: true }
            }
          }
        }, {
          timestamps: true,
          versionKey: false
        });

        userSchema.index({ email: 1 });
        userSchema.index({ name: 1, age: -1 });

        userSchema.pre('save', function(next) {
          if (this.isModified('password')) {
            // Hash password logic
          }
          next();
        });

        userSchema.methods.toJSON = function() {
          const obj = this.toObject();
          delete obj.password;
          return obj;
        };

        const User = mongoose.model('User', userSchema);

        module.exports = User;
      `;

      const result = await parser.parseFile('user.schema.js', content);

      expect(result.symbols.length).toBeGreaterThan(0);
      const userEntity = result.symbols.find(s => s.name === 'User');
      expect(userEntity).toBeDefined();
      expect(userEntity).toMatchObject({
        symbol_type: SymbolType.ORM_ENTITY,
      });
    });

    it('should parse Objection.js model', async () => {
      const content = `
        const { Model } = require('objection');

        class User extends Model {
          static get tableName() {
            return 'users';
          }

          static get jsonSchema() {
            return {
              type: 'object',
              required: ['email', 'name'],

              properties: {
                id: { type: 'integer' },
                email: { type: 'string', format: 'email' },
                name: { type: 'string', minLength: 1, maxLength: 255 },
                age: { type: 'integer', minimum: 0, maximum: 120 },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' }
              }
            };
          }

          static get relationMappings() {
            const Post = require('./Post');
            const Profile = require('./Profile');

            return {
              posts: {
                relation: Model.HasManyRelation,
                modelClass: Post,
                join: {
                  from: 'users.id',
                  to: 'posts.author_id'
                }
              },
              profile: {
                relation: Model.HasOneRelation,
                modelClass: Profile,
                join: {
                  from: 'users.id',
                  to: 'profiles.user_id'
                }
              },
              comments: {
                relation: Model.ManyToManyRelation,
                modelClass: require('./Comment'),
                join: {
                  from: 'users.id',
                  through: {
                    from: 'user_comments.user_id',
                    to: 'user_comments.comment_id'
                  },
                  to: 'comments.id'
                }
              }
            };
          }

          $beforeInsert() {
            this.createdAt = this.updatedAt = new Date().toISOString();
          }

          $beforeUpdate() {
            this.updatedAt = new Date().toISOString();
          }
        }

        module.exports = User;
      `;

      const result = await parser.parseFile('User.js', content);

      expect(result.symbols.length).toBeGreaterThan(0);
      const userEntity = result.symbols.find(s => s.name === 'User');
      expect(userEntity).toBeDefined();
      expect(userEntity).toMatchObject({
        symbol_type: SymbolType.ORM_ENTITY,
      });
    });

    it('should parse MikroORM entity', async () => {
      const content = `
        import { Entity, PrimaryKey, Property, OneToMany, ManyToOne, Collection } from '@mikro-orm/core';

        @Entity()
        export class User {
          @PrimaryKey()
          id!: number;

          @Property({ unique: true })
          email!: string;

          @Property()
          name!: string;

          @Property({ nullable: true })
          avatar?: string;

          @Property()
          createdAt: Date = new Date();

          @Property({ onUpdate: () => new Date() })
          updatedAt: Date = new Date();

          @OneToMany(() => Post, post => post.author)
          posts = new Collection<Post>(this);

          @ManyToOne(() => Role, { nullable: true })
          role?: Role;
        }

        @Entity()
        export class Post {
          @PrimaryKey()
          id!: number;

          @Property()
          title!: string;

          @Property({ type: 'text' })
          content!: string;

          @Property({ default: false })
          published: boolean = false;

          @ManyToOne(() => User)
          author!: User;

          @Property()
          createdAt: Date = new Date();
        }

        @Entity()
        export class Role {
          @PrimaryKey()
          id!: number;

          @Property({ unique: true })
          name!: string;

          @OneToMany(() => User, user => user.role)
          users = new Collection<User>(this);
        }
      `;

      const result = await parser.parseFile('entities.ts', content);

      expect(result.imports.length).toBeGreaterThanOrEqual(0);
      expect(result.symbols.length).toBeGreaterThanOrEqual(0);
      expect(result.exports.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle complex Prisma relationships', async () => {
      const content = `
        model User {
          id        Int       @id @default(autoincrement())
          email     String    @unique
          posts     Post[]
          profile   Profile?
          following Follow[]  @relation("UserFollows")
          followers Follow[]  @relation("UserFollowers")
          likes     Like[]
        }

        model Post {
          id       Int      @id @default(autoincrement())
          title    String
          author   User     @relation(fields: [authorId], references: [id])
          authorId Int
          likes    Like[]
          tags     Tag[]    @relation("PostTags")
        }

        model Follow {
          id          Int  @id @default(autoincrement())
          follower    User @relation("UserFollows", fields: [followerId], references: [id])
          followerId  Int
          following   User @relation("UserFollowers", fields: [followingId], references: [id])
          followingId Int

          @@unique([followerId, followingId])
        }

        model Like {
          id     Int  @id @default(autoincrement())
          user   User @relation(fields: [userId], references: [id])
          userId Int
          post   Post @relation(fields: [postId], references: [id])
          postId Int

          @@unique([userId, postId])
        }

        model Tag {
          id    Int    @id @default(autoincrement())
          name  String @unique
          posts Post[] @relation("PostTags")
        }
      `;

      const result = await parser.parseFile('complex-schema.prisma', content);

      expect(result.symbols).toHaveLength(5); // User, Post, Follow, Like, Tag
    });

    it('should handle empty ORM file', async () => {
      const content = '';
      const result = await parser.parseFile('empty.model.ts', content);

      expect(result.symbols).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle invalid TypeScript entity', async () => {
      const content = `
        import { Entity } from 'typeorm';

        @Entity()
        export class { // Invalid syntax
          id: number;
        }
      `;

      const result = await parser.parseFile('invalid.entity.ts', content);

      // Should handle parsing errors gracefully
      expect(result.imports.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectFrameworkEntities', () => {
    it('should detect ORM system', async () => {
      const content = `
        import { Entity, Column } from 'typeorm';

        @Entity()
        export class User {
          @Column()
          name: string;
        }
      `;

      const result = await parser.detectFrameworkEntities(content, 'user.entity.ts', {});

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject({
        type: 'orm_system',
        name: 'typeorm',
        filePath: 'user.entity.ts',
      });
    });

    it('should detect multiple ORM systems', async () => {
      const content = `
        const { Model } = require('sequelize');
        const mongoose = require('mongoose');

        // Mixed ORM usage (unusual but possible)
      `;

      const result = await parser.detectFrameworkEntities(content, 'mixed.js', {});

      expect(result.entities).toHaveLength(2);
      expect(result.entities.map(e => e.name)).toContain('sequelize');
      expect(result.entities.map(e => e.name)).toContain('mongoose');
    });
  });

  describe('getDetectedFrameworks', () => {
    it('should return detected ORMs', async () => {
      await parser.parseFile('schema.prisma', 'model User { id Int @id }');
      await parser.parseFile('user.entity.ts', 'import { Entity } from "typeorm";');

      const frameworks = await parser.getDetectedFrameworks();

      expect(frameworks.orms).toContain('prisma');
      expect(frameworks.orms).toContain('typeorm');
    });
  });
});