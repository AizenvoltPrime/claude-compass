import { NodeJSParser } from '../../src/parsers/nodejs';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

describe('NodeJSParser', () => {
  let parser: NodeJSParser;
  let tsParser: Parser;

  beforeEach(() => {
    tsParser = new Parser();
    tsParser.setLanguage(JavaScript);
    parser = new NodeJSParser(tsParser);
  });

  afterEach(() => {
    tsParser = null as any;
    parser = null as any;
  });

  describe('Express.js Routes', () => {
    it('should parse Express router with multiple routes', async () => {
      const content = `
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const userController = require('../controllers/userController');

// GET all users
router.get('/', authenticateToken, userController.getAllUsers);

// GET user by ID
router.get('/:id', authenticateToken, userController.getUserById);

// POST create user
router.post('/',
  authenticateToken,
  userController.validateUser,
  userController.createUser
);

// PUT update user
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const userData = req.body;

  User.findByIdAndUpdate(id, userData, { new: true })
    .then(user => res.json(user))
    .catch(err => res.status(500).json({ error: err.message }));
});

// DELETE user
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    await User.findByIdAndDelete(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
      `;

      const result = await parser.parseFile('/routes/users.js', content);

      const routes = result.frameworkEntities!.filter(e => e.type === 'route');
      expect(routes).toHaveLength(5);

      const getRoute = routes.find(r => r.metadata.method === 'GET' && r.metadata.path === '/');
      expect(getRoute!.metadata.middleware).toContain('authenticateToken');
      expect(getRoute!.metadata.controller).toBe('userController.getAllUsers');

      const getUserRoute = routes.find(r => r.metadata.method === 'GET' && r.metadata.path === '/:id');
      expect(getUserRoute!.metadata.dynamic).toBe(true);
      expect(getUserRoute!.metadata.params).toContain('id');

      const createRoute = routes.find(r => r.metadata.method === 'POST');
      expect(createRoute!.metadata.middleware).toContain('authenticateToken');
      expect(createRoute!.metadata.middleware).toContain('userController.validateUser');

      const deleteRoute = routes.find(r => r.metadata.method === 'DELETE');
      expect(deleteRoute!.metadata.isAsync).toBe(true);
      expect(deleteRoute!.metadata.hasErrorHandling).toBe(true);
    });

    it('should parse Express app with direct route definitions', async () => {
      const content = `
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// Global middleware
app.use(express.json());
app.use(cors());
app.use(helmet());

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const token = await authService.login(email, password);
    res.json({ token });
  } catch (error) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.use('/api/users', require('./routes/users'));
app.use('/api/posts', require('./routes/posts'));

// Error handler
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
});

module.exports = app;
      `;

      const result = await parser.parseFile('/app.js', content);

      const routes = result.frameworkEntities!.filter(e => e.type === 'route');
      expect(routes).toHaveLength(2);

      const healthRoute = routes.find(r => r.metadata.path === '/health');
      expect(healthRoute!.metadata.method).toBe('GET');

      const loginRoute = routes.find(r => r.metadata.path === '/api/auth/login');
      expect(loginRoute!.metadata.method).toBe('POST');
      expect(loginRoute!.metadata.isAsync).toBe(true);

      // Should detect middleware
      const middlewareEntities = result.frameworkEntities!.filter(e => e.type === 'middleware');
      expect(middlewareEntities.length).toBeGreaterThan(0);

      // Should detect server configuration
      const serverEntity = result.frameworkEntities!.find(e => e.type === 'server');
      expect(serverEntity!.metadata.port).toBe(3000);
      expect(serverEntity!.metadata.framework).toBe('express');
    });
  });

  describe('Fastify Routes', () => {
    it('should parse Fastify routes', async () => {
      const content = `
const fastify = require('fastify')({ logger: true });

// Register plugins
fastify.register(require('@fastify/cors'));
fastify.register(require('@fastify/helmet'));

// Schema validation
const getUserSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string' }
    }
  }
};

const createUserSchema = {
  body: {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' }
    }
  }
};

// Routes
fastify.get('/users', async (request, reply) => {
  const users = await User.findAll();
  return users;
});

fastify.get('/users/:id', { schema: getUserSchema }, async (request, reply) => {
  const { id } = request.params;
  const user = await User.findById(id);

  if (!user) {
    reply.code(404);
    throw new Error('User not found');
  }

  return user;
});

fastify.post('/users', {
  schema: createUserSchema,
  preHandler: fastify.auth([fastify.verifyJWT])
}, async (request, reply) => {
  const user = await User.create(request.body);
  reply.code(201);
  return user;
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
      `;

      const result = await parser.parseFile('/server.js', content);

      const routes = result.frameworkEntities!.filter(e => e.type === 'route');
      expect(routes).toHaveLength(3);

      const getUsersRoute = routes.find(r => r.metadata.path === '/users' && r.metadata.method === 'GET');
      expect(getUsersRoute!.metadata.framework).toBe('fastify');
      expect(getUsersRoute!.metadata.isAsync).toBe(true);

      const getUserRoute = routes.find(r => r.metadata.path === '/users/:id');
      expect(getUserRoute!.metadata.hasSchema).toBe(true);
      expect(getUserRoute!.metadata.dynamic).toBe(true);

      const createUserRoute = routes.find(r => r.metadata.method === 'POST');
      expect(createUserRoute!.metadata.hasAuth).toBe(true);
      expect(createUserRoute!.metadata.hasSchema).toBe(true);
      expect(createUserRoute!.metadata.preHandlers).toContain('fastify.auth');
    });
  });

  describe('Middleware Detection', () => {
    it('should detect Express middleware functions', async () => {
      const content = `
const jwt = require('jsonwebtoken');

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Authorization middleware
const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Logging middleware
const requestLogger = async (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
  });

  next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  res.status(500).json({ error: 'Internal server error' });
};

module.exports = {
  authenticateToken,
  requireRole,
  requestLogger,
  errorHandler
};
      `;

      const result = await parser.parseFile('/middleware/auth.js', content);

      const middlewareEntities = result.frameworkEntities!.filter(e => e.type === 'middleware');
      expect(middlewareEntities).toHaveLength(4);

      const authMiddleware = middlewareEntities.find(m => m.name === 'authenticateToken');
      expect(authMiddleware!.metadata.hasAuth).toBe(true);
      expect(authMiddleware!.metadata.framework).toBe('express');

      const roleMiddleware = middlewareEntities.find(m => m.name === 'requireRole');
      expect(roleMiddleware!.metadata.isFactory).toBe(true); // Returns a function
      expect(roleMiddleware!.metadata.hasAuthorization).toBe(true);

      const loggerMiddleware = middlewareEntities.find(m => m.name === 'requestLogger');
      expect(loggerMiddleware!.metadata.isAsync).toBe(true);

      const errorMiddleware = middlewareEntities.find(m => m.name === 'errorHandler');
      expect(errorMiddleware!.metadata.isErrorHandler).toBe(true);
      expect(errorMiddleware!.metadata.paramCount).toBe(4); // err, req, res, next
    });
  });

  describe('Controller Detection', () => {
    it('should detect controller classes and methods', async () => {
      const content = `
const { User } = require('../models');
const { validationResult } = require('express-validator');

class UserController {
  // Get all users
  async getAllUsers(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      const users = await User.findAndCountAll({
        limit,
        offset,
        order: [['createdAt', 'DESC']]
      });

      res.json({
        users: users.rows,
        total: users.count,
        page,
        totalPages: Math.ceil(users.count / limit)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Get user by ID
  async getUserById(req, res) {
    try {
      const { id } = req.params;
      const user = await User.findByPk(id);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Create user
  async createUser(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = await User.create(req.body);
      res.status(201).json(user);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        res.status(409).json({ error: 'Email already exists' });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  // Validation middleware
  validateUser(req, res, next) {
    // Validation logic
    next();
  }
}

module.exports = new UserController();
      `;

      const result = await parser.parseFile('/controllers/userController.js', content);

      const controllerEntity = result.frameworkEntities!.find(e => e.type === 'controller');
      expect(controllerEntity!.name).toBe('UserController');
      expect(controllerEntity!.metadata.methods).toContain('getAllUsers');
      expect(controllerEntity!.metadata.methods).toContain('getUserById');
      expect(controllerEntity!.metadata.methods).toContain('createUser');
      expect(controllerEntity!.metadata.methods).toContain('validateUser');

      const getAllMethod = result.frameworkEntities!.find(e => e.name === 'getAllUsers' && e.type === 'route-handler');
      expect(getAllMethod!.metadata.hasPagination).toBe(true);
      expect(getAllMethod!.metadata.hasErrorHandling).toBe(true);
      expect(getAllMethod!.metadata.isAsync).toBe(true);

      const createMethod = result.frameworkEntities!.find(e => e.name === 'createUser' && e.type === 'route-handler');
      expect(createMethod!.metadata.hasValidation).toBe(true);
    });
  });

  describe('API Documentation', () => {
    it('should detect Swagger/OpenAPI documentation', async () => {
      const content = `
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'User API',
      version: '1.0.0',
      description: 'A simple user management API',
    },
  },
  apis: ['./routes/*.js'],
};

const specs = swaggerJsdoc(options);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
router.get('/api/users', userController.getAllUsers);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User found
 *       404:
 *         description: User not found
 */
router.get('/api/users/:id', userController.getUserById);
      `;

      const result = await parser.parseFile('/routes/users.js', content);

      const routes = result.frameworkEntities!.filter(e => e.type === 'route');
      expect(routes).toHaveLength(2);

      const getUsersRoute = routes.find(r => r.metadata.path === '/api/users' && r.metadata.method === 'GET');
      expect(getUsersRoute!.metadata.hasSwaggerDoc).toBe(true);
      expect(getUsersRoute!.metadata.swaggerTags).toContain('Users');

      const getUserRoute = routes.find(r => r.metadata.path === '/api/users/:id');
      expect(getUserRoute!.metadata.hasSwaggerDoc).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle non-Node.js files gracefully', async () => {
      const content = `
export function regularFunction() {
  return 'Not a Node.js file';
}

const data = {
  items: []
};
      `;

      const result = await parser.parseFile('/src/utils.js', content);

      expect(result.frameworkEntities).toHaveLength(0);
      expect(result.metadata.isFrameworkSpecific).toBe(false);
    });

    it('should handle malformed route definitions', async () => {
      const content = `
const express = require('express');
const app = express();

// Malformed route
app.get('/broken', (req, res => {
  res.json({ message: 'broken' })
});

// Valid route
app.get('/working', (req, res) => {
  res.json({ message: 'working' });
});
      `;

      const result = await parser.parseFile('/app.js', content);

      expect(result.errors.length).toBeGreaterThan(0);
      // Should still parse the valid route
      expect(result.frameworkEntities!.filter(e => e.type === 'route')).toHaveLength(1);
    });
  });

  describe('framework patterns', () => {
    it('should return correct framework patterns', () => {
      const patterns = parser.getFrameworkPatterns();

      expect(patterns.some(p => p.name === 'express-routes')).toBe(true);
      expect(patterns.some(p => p.name === 'fastify-routes')).toBe(true);
      expect(patterns.some(p => p.name === 'middleware')).toBe(true);
      expect(patterns.some(p => p.name === 'controller')).toBe(true);

      const expressPattern = patterns.find(p => p.name === 'express-routes');
      expect(expressPattern!.fileExtensions).toContain('.js');
      expect(expressPattern!.fileExtensions).toContain('.ts');
    });
  });

  describe('TypeScript support', () => {
    it('should parse TypeScript Express routes', async () => {
      const content = `
import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const router = express.Router();

router.get('/users',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await userService.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post('/users',
  [
    body('name').isLength({ min: 1 }).trim(),
    body('email').isEmail().normalizeEmail(),
  ],
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const user = await userService.createUser(req.body);
      res.status(201).json(user);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

export default router;
      `;

      const result = await parser.parseFile('/routes/users.ts', content);

      const routes = result.frameworkEntities!.filter(e => e.type === 'route');
      expect(routes).toHaveLength(2);

      const createRoute = routes.find(r => r.metadata.method === 'POST');
      expect(createRoute!.metadata.hasValidation).toBe(true);
      expect(createRoute!.metadata.typescript).toBe(true);
      expect(createRoute!.metadata.middleware).toContain('body');
    });
  });
});