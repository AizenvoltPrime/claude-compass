-- Initialize Claude Compass database with required extensions

\c claude_compass;

-- Enable pgvector extension for vector operations (future AI features)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for fuzzy text search capabilities
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable btree_gin for composite index support
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Grant necessary permissions to the user
GRANT ALL PRIVILEGES ON DATABASE claude_compass TO claude_compass;
GRANT ALL ON SCHEMA public TO claude_compass;

-- Also initialize test database if it exists
\c claude_compass_test;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

GRANT ALL PRIVILEGES ON DATABASE claude_compass_test TO claude_compass;
GRANT ALL ON SCHEMA public TO claude_compass;