import { ReactParser } from '../../src/parsers/react';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

describe('ReactParser', () => {
  let parser: ReactParser;

  beforeEach(() => {
    const tsParser = new Parser();
    tsParser.setLanguage(JavaScript);
    parser = new ReactParser(tsParser);
  });

  describe('React Components', () => {
    it('should parse functional component with hooks', async () => {
      const content = `
import React, { useState, useEffect, useCallback } from 'react';

interface Props {
  title: string;
  onSubmit: (value: string) => void;
}

export default function UserForm({ title, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = title;
  }, [title]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setLoading(true);
    onSubmit({ name, email });
  }, [name, email, onSubmit]);

  return (
    <form onSubmit={handleSubmit}>
      <h1>{title}</h1>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
      `;

      const result = await parser.parseFile('/src/components/UserForm.tsx', content);

      expect(result.frameworkEntities).toHaveLength(1);

      const component = result.frameworkEntities![0];
      expect(component.type).toBe('component');
      expect(component.name).toBe('UserForm');
      expect(component.metadata.type).toBe('function');
      expect(component.metadata.hooks).toContain('useState');
      expect(component.metadata.hooks).toContain('useEffect');
      expect(component.metadata.hooks).toContain('useCallback');
      expect(component.metadata.props).toContain('title');
      expect(component.metadata.props).toContain('onSubmit');
      expect(component.metadata.isDefault).toBe(true);

      // Should detect React imports
      expect(result.imports.some(i => i.source === 'react')).toBe(true);
    });

    it('should parse class component', async () => {
      const content = `
import React, { Component } from 'react';
import PropTypes from 'prop-types';

class Counter extends Component {
  static propTypes = {
    initialValue: PropTypes.number,
    onCountChange: PropTypes.func
  }

  static defaultProps = {
    initialValue: 0
  }

  constructor(props) {
    super(props);
    this.state = {
      count: props.initialValue || 0,
      history: []
    };
  }

  componentDidMount() {
    console.log('Counter mounted');
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.count !== this.state.count) {
      this.props.onCountChange?.(this.state.count);
    }
  }

  increment = () => {
    this.setState(prevState => ({
      count: prevState.count + 1,
      history: [...prevState.history, 'increment']
    }));
  }

  decrement = () => {
    this.setState(prevState => ({
      count: prevState.count - 1,
      history: [...prevState.history, 'decrement']
    }));
  }

  render() {
    const { count } = this.state;

    return (
      <div className="counter">
        <h2>Count: {count}</h2>
        <button onClick={this.increment}>+</button>
        <button onClick={this.decrement}>-</button>
      </div>
    );
  }
}

export default Counter;
      `;

      const result = await parser.parseFile('/src/components/Counter.jsx', content);

      const component = result.frameworkEntities![0];
      expect(component.type).toBe('component');
      expect(component.name).toBe('Counter');
      expect(component.metadata.type).toBe('class');
      expect(component.metadata.lifecycle).toContain('componentDidMount');
      expect(component.metadata.lifecycle).toContain('componentDidUpdate');
      expect(component.metadata.state).toContain('count');
      expect(component.metadata.state).toContain('history');
      expect(component.metadata.methods).toContain('increment');
      expect(component.metadata.methods).toContain('decrement');
    });

    it('should parse memo and forwardRef components', async () => {
      const content = `
import React, { memo, forwardRef, useImperativeHandle } from 'react';

const Button = memo(forwardRef(({ children, onClick, ...props }, ref) => {
  useImperativeHandle(ref, () => ({
    focus: () => {
      // Focus implementation
    }
  }));

  return (
    <button onClick={onClick} {...props} ref={ref}>
      {children}
    </button>
  );
}));

Button.displayName = 'Button';

export default Button;
      `;

      const result = await parser.parseFile('/src/components/Button.jsx', content);

      const component = result.frameworkEntities![0];
      expect(component.name).toBe('Button');
      expect(component.metadata.isMemo).toBe(true);
      expect(component.metadata.isForwardRef).toBe(true);
      expect(component.metadata.hooks).toContain('useImperativeHandle');
    });

    it('should parse component with custom hooks', async () => {
      const content = `
import React from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useApi } from './hooks/useApi';

export function Settings() {
  const [theme, setTheme] = useLocalStorage('theme', 'light');
  const { data: user, loading, error } = useApi('/api/user');

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className={theme}>
      <h1>Settings</h1>
      <select value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <p>Welcome, {user?.name}</p>
    </div>
  );
}
      `;

      const result = await parser.parseFile('/src/components/Settings.tsx', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.hooks).toContain('useLocalStorage');
      expect(component.metadata.hooks).toContain('useApi');
      expect(component.metadata.customHooks).toContain('useLocalStorage');
      expect(component.metadata.customHooks).toContain('useApi');
    });
  });

  describe('React Hooks', () => {
    it('should parse custom hook', async () => {
      const content = `
import { useState, useEffect, useRef } from 'react';

export function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  };

  return [storedValue, setValue];
}
      `;

      const result = await parser.parseFile('/src/hooks/useUtils.js', content);

      expect(result.frameworkEntities).toHaveLength(2);

      const debounceHook = result.frameworkEntities!.find(e => e.name === 'useDebounce');
      expect(debounceHook!.type).toBe('hook');
      expect(debounceHook!.metadata.hooks).toContain('useState');
      expect(debounceHook!.metadata.hooks).toContain('useEffect');
      expect(debounceHook!.metadata.returns).toBe('debouncedValue');

      const storageHook = result.frameworkEntities!.find(e => e.name === 'useLocalStorage');
      expect(storageHook!.metadata.returns).toEqual(['storedValue', 'setValue']);
    });
  });

  describe('JSX dependencies', () => {
    it('should extract JSX component dependencies', async () => {
      const content = `
import React from 'react';
import Header from './Header';
import { Button, Modal } from './ui';
import { UserCard as Card } from './UserCard';

export default function Dashboard({ user }) {
  return (
    <div>
      <Header title="Dashboard" />
      <main>
        <Card user={user} />
        <div className="actions">
          <Button variant="primary">Save</Button>
          <Button variant="secondary">Cancel</Button>
        </div>
      </main>
      <Modal open={true}>
        <p>Modal content</p>
      </Modal>
    </div>
  );
}
      `;

      const result = await parser.parseFile('/src/pages/Dashboard.jsx', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.jsxDependencies).toContain('Header');
      expect(component.metadata.jsxDependencies).toContain('Button');
      expect(component.metadata.jsxDependencies).toContain('Modal');
      expect(component.metadata.jsxDependencies).toContain('Card');

      // Should also track imports
      expect(result.imports.some(i => i.source === './Header')).toBe(true);
      expect(result.imports.some(i => i.source === './ui')).toBe(true);
      expect(result.imports.some(i => i.source === './UserCard')).toBe(true);
    });

    it('should handle dynamic component references', async () => {
      const content = `
import React from 'react';

const components = {
  header: () => import('./Header'),
  footer: () => import('./Footer')
};

export function DynamicLayout({ componentType }) {
  const Component = React.lazy(components[componentType]);

  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Component />
    </React.Suspense>
  );
}
      `;

      const result = await parser.parseFile('/src/DynamicLayout.jsx', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.hasSuspense).toBe(true);
      expect(component.metadata.hasLazy).toBe(true);
    });
  });

  describe('Higher-Order Components', () => {
    it('should detect HOC patterns', async () => {
      const content = `
import React from 'react';

export function withAuth(WrappedComponent) {
  return function AuthComponent(props) {
    const { user } = useAuth();

    if (!user) {
      return <LoginPrompt />;
    }

    return <WrappedComponent {...props} user={user} />;
  };
}

export const withLoading = (WrappedComponent) => ({ loading, ...props }) => {
  if (loading) return <Spinner />;
  return <WrappedComponent {...props} />;
};

const EnhancedComponent = withAuth(withLoading(UserProfile));
      `;

      const result = await parser.parseFile('/src/hoc/withAuth.jsx', content);

      const hocEntities = result.frameworkEntities!.filter(e => e.type === 'hoc');
      expect(hocEntities).toHaveLength(2);

      const authHoc = hocEntities.find(h => h.name === 'withAuth');
      expect(authHoc!.metadata.wrapsComponent).toBe(true);
      expect(authHoc!.metadata.returnsComponent).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSX', async () => {
      const content = `
import React from 'react';

export function BrokenComponent() {
  return (
    <div>
      <h1>Unclosed tag
      <p>Some content
    </div>
  );
}
      `;

      const result = await parser.parseFile('/src/BrokenComponent.jsx', content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.frameworkEntities).toHaveLength(1);
      expect(result.frameworkEntities![0].name).toBe('BrokenComponent');
    });

    it('should handle non-React files gracefully', async () => {
      const content = `
export function regularFunction() {
  return 'Not a React component';
}

const data = {
  items: []
};
      `;

      const result = await parser.parseFile('/src/utils.js', content);

      expect(result.frameworkEntities).toHaveLength(0);
      expect(result.metadata.isFrameworkSpecific).toBe(false);
    });
  });

  describe('framework patterns', () => {
    it('should return correct framework patterns', () => {
      const patterns = parser.getFrameworkPatterns();

      expect(patterns.some(p => p.name === 'react-component')).toBe(true);
      expect(patterns.some(p => p.name === 'react-hook')).toBe(true);
      expect(patterns.some(p => p.name === 'react-hoc')).toBe(true);

      const componentPattern = patterns.find(p => p.name === 'react-component');
      expect(componentPattern!.fileExtensions).toContain('.jsx');
      expect(componentPattern!.fileExtensions).toContain('.tsx');
    });
  });

  describe('TypeScript support', () => {
    it('should parse TypeScript React component with interfaces', async () => {
      const content = `
import React, { FC } from 'react';

interface User {
  id: number;
  name: string;
  email: string;
}

interface Props {
  users: User[];
  onUserSelect: (user: User) => void;
}

export const UserList: FC<Props> = ({ users, onUserSelect }) => {
  return (
    <ul>
      {users.map(user => (
        <li key={user.id} onClick={() => onUserSelect(user)}>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </li>
      ))}
    </ul>
  );
};
      `;

      const result = await parser.parseFile('/src/UserList.tsx', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.typescript).toBe(true);
      expect(component.metadata.props).toContain('users');
      expect(component.metadata.props).toContain('onUserSelect');

      // Should detect TypeScript interfaces
      expect(result.symbols.some(s => s.name === 'User' && s.symbol_type === 'interface')).toBe(true);
      expect(result.symbols.some(s => s.name === 'Props' && s.symbol_type === 'interface')).toBe(true);
    });
  });
});