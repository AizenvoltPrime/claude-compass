import { NextJSParser } from '../../src/parsers/nextjs';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

describe('NextJSParser', () => {
  let parser: NextJSParser;

  beforeEach(() => {
    const tsParser = new Parser();
    tsParser.setLanguage(JavaScript);
    parser = new NextJSParser(tsParser);
  });

  describe('Pages Router', () => {
    it('should parse pages router page component', async () => {
      const content = `
import React from 'react';
import { GetServerSideProps, GetStaticProps } from 'next';
import Head from 'next/head';

interface Props {
  user: {
    id: number;
    name: string;
  };
}

export default function UserProfile({ user }: Props) {
  return (
    <>
      <Head>
        <title>{user.name} - Profile</title>
      </Head>
      <div>
        <h1>Welcome, {user.name}!</h1>
        <p>User ID: {user.id}</p>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { id } = context.params!;

  const user = await fetchUser(id);

  if (!user) {
    return {
      notFound: true
    };
  }

  return {
    props: {
      user
    }
  };
};
      `;

      const result = await parser.parseFile('/pages/user/[id].tsx', content);

      expect(result.frameworkEntities).toHaveLength(1);

      const page = result.frameworkEntities![0] as any;
      expect(page.type).toBe('nextjs-page-route');
      expect(page.name).toBe('[id]');
      expect(page.metadata!.routeType).toBe('page');
      expect(page.path).toBe('/user/:id');
      expect(page.dynamicSegments).toContain('id');
      expect(page.metadata!.hasGetServerSideProps).toBe(true);
      expect(page.metadata!.isServerSideRendered).toBe(true);
    });

    it('should parse static page with getStaticProps', async () => {
      const content = `
import React from 'react';
import { GetStaticProps, GetStaticPaths } from 'next';

interface Post {
  id: string;
  title: string;
  content: string;
}

interface Props {
  post: Post;
}

export default function BlogPost({ post }: Props) {
  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
    </article>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getPosts();

  return {
    paths: posts.map(post => ({ params: { slug: post.id } })),
    fallback: 'blocking'
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const post = await getPost(params!.slug as string);

  return {
    props: {
      post
    },
    revalidate: 60
  };
};
      `;

      const result = await parser.parseFile('/pages/blog/[slug].tsx', content);

      const page = result.frameworkEntities![0];
      expect(page.metadata!.dataFetching).toContain('getStaticProps');
      expect(page.metadata!.dataFetching).toContain('getStaticPaths');
      expect(page.metadata!.isr).toBe(true);
      expect(page.metadata!.fallback).toBe('blocking');
    });

    it('should parse API route', async () => {
      const content = `
import { NextApiRequest, NextApiResponse } from 'next';
import { createUser, getUserById, updateUser, deleteUser } from '@/lib/users';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  switch (req.method) {
    case 'GET':
      try {
        if (id) {
          const user = await getUserById(id as string);
          return res.status(200).json(user);
        } else {
          const users = await getAllUsers();
          return res.status(200).json(users);
        }
      } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch users' });
      }

    case 'POST':
      try {
        const user = await createUser(req.body);
        return res.status(201).json(user);
      } catch (error) {
        return res.status(500).json({ error: 'Failed to create user' });
      }

    case 'PUT':
      if (!id) {
        return res.status(400).json({ error: 'User ID required' });
      }

      try {
        const user = await updateUser(id as string, req.body);
        return res.status(200).json(user);
      } catch (error) {
        return res.status(500).json({ error: 'Failed to update user' });
      }

    case 'DELETE':
      if (!id) {
        return res.status(400).json({ error: 'User ID required' });
      }

      try {
        await deleteUser(id as string);
        return res.status(204).end();
      } catch (error) {
        return res.status(500).json({ error: 'Failed to delete user' });
      }

    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      return res.status(405).end();
  }
}
      `;

      const result = await parser.parseFile('/pages/api/users/[id].ts', content);

      expect(result.frameworkEntities).toHaveLength(4); // One for each HTTP method

      const apiRoutes = result.frameworkEntities!.filter(e => e.type === 'api-route');
      expect(apiRoutes).toHaveLength(4);

      const getRoute = apiRoutes.find(r => r.metadata!.method === 'GET');
      expect(getRoute!.metadata!.route).toBe('/api/users/[id]');
      expect(getRoute!.metadata!.dynamic).toBe(true);

      const postRoute = apiRoutes.find(r => r.metadata!.method === 'POST');
      expect(postRoute!.metadata!.route).toBe('/api/users/[id]');
    });
  });

  describe('App Router', () => {
    it('should parse app router page component', async () => {
      const content = `
import { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface Props {
  params: {
    id: string;
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await getUser(params.id);

  return {
    title: \`\${user.name} - Profile\`,
    description: \`View \${user.name}'s profile\`
  };
}

export default async function UserPage({ params }: Props) {
  const user = await getUser(params.id);

  if (!user) {
    notFound();
  }

  return (
    <div>
      <h1>{user.name}</h1>
      <p>Email: {user.email}</p>
    </div>
  );
}

export async function generateStaticParams() {
  const users = await getUsers();

  return users.map((user) => ({
    id: user.id.toString()
  }));
}
      `;

      const result = await parser.parseFile('/app/users/[id]/page.tsx', content);

      const page = result.frameworkEntities![0];
      expect(page.type).toBe('page');
      expect(page.metadata!.router).toBe('app');
      expect(page.metadata!.route).toBe('/users/[id]');
      expect(page.metadata!.serverComponent).toBe(true);
      expect(page.metadata!.generateMetadata).toBe(true);
      expect(page.metadata!.generateStaticParams).toBe(true);
    });

    it('should parse app router layout component', async () => {
      const content = `
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'My App',
  description: 'Generated by create-next-app',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header>
          <nav>Navigation</nav>
        </header>
        <main>{children}</main>
        <footer>Footer</footer>
      </body>
    </html>
  );
}
      `;

      const result = await parser.parseFile('/app/layout.tsx', content);

      const layout = result.frameworkEntities![0];
      expect(layout.type).toBe('layout');
      expect(layout.name).toBe('RootLayout');
      expect(layout.metadata!.router).toBe('app');
      expect(layout.metadata!.isRoot).toBe(true);
      expect(layout.metadata!.hasMetadata).toBe(true);
    });

    it('should parse app router loading component', async () => {
      const content = `
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-[250px]" />
      <Skeleton className="h-4 w-[200px]" />
      <Skeleton className="h-4 w-[300px]" />
    </div>
  );
}
      `;

      const result = await parser.parseFile('/app/dashboard/loading.tsx', content);

      const loading = result.frameworkEntities![0];
      expect(loading.type).toBe('loading');
      expect(loading.metadata!.route).toBe('/dashboard');
    });

    it('should parse app router error component', async () => {
      const content = `
'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
      `;

      const result = await parser.parseFile('/app/dashboard/error.tsx', content);

      const error = result.frameworkEntities![0];
      expect(error.type).toBe('error');
      expect(error.metadata!.clientComponent).toBe(true);
      expect(error.metadata!.hasReset).toBe(true);
    });

    it('should parse app router API route', async () => {
      const content = `
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = searchParams.get('page') || '1';
  const limit = searchParams.get('limit') || '10';

  try {
    const users = await getUsers({ page: parseInt(page), limit: parseInt(limit) });
    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = createUserSchema.parse(body);

    const user = await createUser(validated);
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
      `;

      const result = await parser.parseFile('/app/api/users/route.ts', content);

      const apiRoutes = result.frameworkEntities!.filter(e => e.type === 'api-route');
      expect(apiRoutes).toHaveLength(2);

      const getRoute = apiRoutes.find(r => r.metadata!.method === 'GET');
      expect(getRoute!.metadata!.route).toBe('/api/users');
      expect(getRoute!.metadata!.router).toBe('app');

      const postRoute = apiRoutes.find(r => r.metadata!.method === 'POST');
      expect(postRoute!.metadata!.hasValidation).toBe(true);
    });
  });

  describe('Middleware', () => {
    it('should parse Next.js middleware', async () => {
      const content = `
import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token');

  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (token) {
    try {
      verify(token.value, process.env.JWT_SECRET!);
    } catch (error) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*']
};
      `;

      const result = await parser.parseFile('/middleware.ts', content);

      const middleware = result.frameworkEntities![0];
      expect(middleware.type).toBe('middleware');
      expect(middleware.metadata!.matcher).toContain('/dashboard/:path*');
      expect(middleware.metadata!.matcher).toContain('/admin/:path*');
      expect(middleware.metadata!.hasAuth).toBe(true);
    });
  });

  describe('Dynamic Routes', () => {
    it('should extract dynamic segments from file paths', async () => {
      const testCases = [
        { path: '/pages/users/[id].tsx', expected: '/users/[id]', dynamic: ['id'] },
        { path: '/pages/blog/[...slug].tsx', expected: '/blog/[...slug]', dynamic: ['slug'] },
        { path: '/pages/shop/[[...params]].tsx', expected: '/shop/[[...params]]', dynamic: ['params'] },
        { path: '/app/users/[id]/posts/[postId]/page.tsx', expected: '/users/[id]/posts/[postId]', dynamic: ['id', 'postId'] }
      ];

      for (const { path, expected, dynamic } of testCases) {
        const content = 'export default function Page() { return <div>Test</div>; }';
        const result = await parser.parseFile(path, content);

        const page = result.frameworkEntities![0];
        expect(page.metadata!.route).toBe(expected);
        expect(page.metadata!.dynamic).toBe(true);
        expect(page.metadata!.dynamicSegments).toEqual(dynamic);
      }
    });
  });

  describe('error handling', () => {
    it('should handle non-Next.js files gracefully', async () => {
      const content = `
export function regularComponent() {
  return <div>Not a Next.js component</div>;
}
      `;

      const result = await parser.parseFile('/src/components/Regular.tsx', content);

      expect(result.frameworkEntities).toHaveLength(0);
      expect(result.metadata!.isFrameworkSpecific).toBe(false);
    });

    it('should handle malformed Next.js files', async () => {
      const content = `
import { GetServerSideProps } from 'next';

export default function BrokenPage() {
  return (
    <div>
      <h1>Unclosed tag
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  // Broken function
  return {
    props: {
    }
  };
};
      `;

      const result = await parser.parseFile('/pages/broken.tsx', content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.frameworkEntities).toHaveLength(1);
      expect(result.frameworkEntities![0].name).toBe('BrokenPage');
    });
  });

  describe('framework patterns', () => {
    it('should return correct framework patterns', () => {
      const patterns = parser.getFrameworkPatterns();

      expect(patterns.some(p => p.name === 'nextjs-page')).toBe(true);
      expect(patterns.some(p => p.name === 'nextjs-api')).toBe(true);
      expect(patterns.some(p => p.name === 'nextjs-middleware')).toBe(true);
      expect(patterns.some(p => p.name === 'nextjs-layout')).toBe(true);

      const pagePattern = patterns.find(p => p.name === 'nextjs-page');
      expect(pagePattern!.fileExtensions).toContain('.tsx');
      expect(pagePattern!.fileExtensions).toContain('.jsx');
    });
  });

  describe('special Next.js features', () => {
    it('should detect Image optimization usage', async () => {
      const content = `
import Image from 'next/image';
import profilePic from '/me.png';

export default function Profile() {
  return (
    <div>
      <Image
        src={profilePic}
        alt="Picture of me"
        width={500}
        height={500}
        priority
      />
      <Image
        src="/hero.jpg"
        alt="Hero image"
        fill
        style={{ objectFit: 'cover' }}
      />
    </div>
  );
}
      `;

      const result = await parser.parseFile('/pages/profile.tsx', content);

      const page = result.frameworkEntities![0];
      expect(page.metadata!.usesImage).toBe(true);
      expect(page.metadata!.imageOptimization).toBe(true);
    });

    it('should detect client component directive', async () => {
      const content = `
'use client';

import { useState } from 'react';

export default function ClientComponent() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
      `;

      const result = await parser.parseFile('/app/counter/page.tsx', content);

      const page = result.frameworkEntities![0];
      expect(page.metadata!.clientComponent).toBe(true);
      expect(page.metadata!.serverComponent).toBe(false);
    });
  });
});