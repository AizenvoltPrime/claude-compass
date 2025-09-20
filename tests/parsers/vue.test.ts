import { VueParser } from '../../src/parsers/vue';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { jest } from '@jest/globals';
import { createTestParser, cleanupTestParser, cleanupAllTestParsers } from '../utils/tree-sitter-factory';

describe('VueParser', () => {
  let parser: VueParser;
  let tsParser: Parser;

  beforeEach(() => {
    // Create a fresh parser using the isolation factory with module cache clearing
    tsParser = createTestParser(JavaScript, 'vue-test');
    parser = new VueParser(tsParser);
  });

  afterEach(() => {
    // Clean up parsers using the factory
    if (tsParser) {
      cleanupTestParser(tsParser);
      tsParser = null as any;
    }

    if (parser) {
      parser = null as any;
    }
  });

  // Clean up all test parsers after the entire suite
  afterAll(() => {
    cleanupAllTestParsers();
  });

  describe('Vue Single File Components', () => {
    it('should parse Vue SFC with setup script', async () => {
      const content = `
<template>
  <div class="counter">
    <h1>{{ title }}</h1>
    <button @click="increment">{{ count }}</button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const title = ref('Counter App')
const count = ref(0)

const increment = () => {
  count.value++
}

const doubleCount = computed(() => count.value * 2)

defineProps({
  initialCount: {
    type: Number,
    default: 0
  }
})

defineEmits(['increment', 'decrement'])
</script>

<style scoped>
.counter {
  text-align: center;
}
</style>
      `;

      const result = await parser.parseFile('/src/Counter.vue', content);

      expect(result.frameworkEntities).toHaveLength(1);

      const component = result.frameworkEntities![0];
      expect(component.type).toBe('component');
      expect(component.name).toBe('Counter');
      expect(component.metadata.props).toContain('initialCount');
      expect(component.metadata.emits).toContain('increment');
      expect(component.metadata.emits).toContain('decrement');
      expect(component.metadata.scriptSetup).toBe(true);

      // Should detect reactive refs
      expect(result.symbols.some(s => s.name === 'title' && s.symbol_type === 'variable')).toBe(true);
      expect(result.symbols.some(s => s.name === 'count' && s.symbol_type === 'variable')).toBe(true);
      expect(result.symbols.some(s => s.name === 'increment' && s.symbol_type === 'function')).toBe(true);

      // Should detect Vue imports
      expect(result.imports.some(i => i.source === 'vue')).toBe(true);
    });

    it('should parse Vue SFC with options API', async () => {
      const content = `
<template>
  <div>
    <h1>{{ message }}</h1>
    <input v-model="inputValue" @change="handleChange">
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex'

export default {
  name: 'MyComponent',

  props: {
    title: String,
    count: {
      type: Number,
      default: 0
    }
  },

  data() {
    return {
      message: 'Hello Vue',
      inputValue: ''
    }
  },

  computed: {
    ...mapState(['user']),

    computedMessage() {
      return this.message + ' - ' + this.title
    }
  },

  methods: {
    ...mapActions(['updateUser']),

    handleChange() {
      this.$emit('change', this.inputValue)
    }
  },

  mounted() {
    console.log('Component mounted')
  }
}
</script>
      `;

      const result = await parser.parseFile('/src/MyComponent.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.type).toBe('component');
      expect(component.name).toBe('MyComponent');
      expect(component.metadata.props).toContain('title');
      expect(component.metadata.props).toContain('count');
      expect(component.metadata.scriptSetup).toBe(false);
      expect(component.metadata.lifecycle).toContain('mounted');

      // Should detect Vuex usage
      expect(result.imports.some(i => i.source === 'vuex')).toBe(true);
    });

    it('should handle Vue SFC with TypeScript', async () => {
      const content = `
<template>
  <div>{{ typedMessage }}</div>
</template>

<script setup lang="ts">
interface User {
  name: string
  age: number
}

const user: User = {
  name: 'John',
  age: 30
}

const typedMessage = computed((): string => {
  return \`Hello \${user.name}, age \${user.age}\`
})
</script>
      `;

      const result = await parser.parseFile('/src/TypedComponent.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.name).toBe('TypedComponent');
      expect(component.metadata.scriptLang).toBe('ts');
      expect(result.symbols.some(s => s.name === 'User' && s.symbol_type === 'interface')).toBe(true);
    });

    it('should parse Vue SFC without script section', async () => {
      const content = `
<template>
  <div class="static-component">
    <h1>Static Content</h1>
    <p>This component has no script</p>
  </div>
</template>

<style scoped>
.static-component {
  background: white;
}
</style>
      `;

      const result = await parser.parseFile('/src/StaticComponent.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.type).toBe('component');
      expect(component.name).toBe('StaticComponent');
      expect(component.metadata.hasScript).toBe(false);
      expect(component.metadata.hasStyle).toBe(true);
    });
  });

  describe('Vue Composables', () => {
    it('should detect composable functions', async () => {
      const content = `
import { ref, computed, onMounted } from 'vue'

export function useCounter(initialValue = 0) {
  const count = ref(initialValue)

  const doubleCount = computed(() => count.value * 2)

  const increment = () => {
    count.value++
  }

  const decrement = () => {
    count.value--
  }

  onMounted(() => {
    console.log('Counter composable mounted')
  })

  return {
    count: readonly(count),
    doubleCount,
    increment,
    decrement
  }
}

export function useAuth() {
  const user = ref(null)
  const isAuthenticated = computed(() => !!user.value)

  const login = async (credentials) => {
    // Login logic
    user.value = { name: 'User' }
  }

  const logout = () => {
    user.value = null
  }

  return {
    user: readonly(user),
    isAuthenticated,
    login,
    logout
  }
}
      `;

      const result = await parser.parseFile('/src/composables/useCounter.ts', content);

      expect(result.frameworkEntities).toHaveLength(2);

      const counterComposable = result.frameworkEntities!.find(e => e.name === 'useCounter');
      expect(counterComposable!.type).toBe('composable');
      expect(counterComposable!.metadata.returns).toContain('count');
      expect(counterComposable!.metadata.returns).toContain('increment');
      expect(counterComposable!.metadata.lifecycle).toContain('onMounted');

      const authComposable = result.frameworkEntities!.find(e => e.name === 'useAuth');
      expect(authComposable!.type).toBe('composable');
      expect(authComposable!.metadata.returns).toContain('login');
      expect(authComposable!.metadata.returns).toContain('logout');
    });
  });

  describe('Vue Router', () => {
    it('should parse Vue Router configuration', async () => {
      const content = `
import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import About from '@/views/About.vue'
import UserProfile from '@/views/UserProfile.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: { requiresAuth: false }
  },
  {
    path: '/about',
    name: 'About',
    component: About
  },
  {
    path: '/user/:id',
    name: 'UserProfile',
    component: UserProfile,
    props: true,
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('@/views/Admin.vue'),
    meta: { requiresAuth: true, role: 'admin' }
  }
]

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes
})

router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth && !isAuthenticated()) {
    next('/login')
  } else {
    next()
  }
})

export default router
      `;

      const result = await parser.parseFile('/src/router/index.js', content);

      const routerEntities = result.frameworkEntities!.filter(e => e.type === 'route');
      expect(routerEntities).toHaveLength(4);

      const homeRoute = routerEntities.find(r => r.metadata.name === 'Home');
      expect(homeRoute!.metadata.path).toBe('/');
      expect(homeRoute!.metadata.component).toBe('Home');
      expect(homeRoute!.metadata.requiresAuth).toBe(false);

      const userRoute = routerEntities.find(r => r.metadata.name === 'UserProfile');
      expect(userRoute!.metadata.path).toBe('/user/:id');
      expect(userRoute!.metadata.dynamic).toBe(true);
      expect(userRoute!.metadata.requiresAuth).toBe(true);

      const adminRoute = routerEntities.find(r => r.metadata.name === 'Admin');
      expect(adminRoute!.metadata.lazy).toBe(true);
    });
  });

  describe('Pinia Stores', () => {
    it('should parse Pinia store definition', async () => {
      const content = `
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref(null)
  const preferences = ref({
    theme: 'light',
    language: 'en'
  })

  // Getters
  const isLoggedIn = computed(() => !!user.value)
  const fullName = computed(() => {
    if (!user.value) return ''
    return \`\${user.value.firstName} \${user.value.lastName}\`
  })

  // Actions
  const login = async (credentials) => {
    try {
      const response = await api.login(credentials)
      user.value = response.data.user
      return true
    } catch (error) {
      console.error('Login failed:', error)
      return false
    }
  }

  const logout = () => {
    user.value = null
  }

  const updatePreferences = (newPrefs) => {
    preferences.value = { ...preferences.value, ...newPrefs }
  }

  return {
    // State
    user: readonly(user),
    preferences: readonly(preferences),

    // Getters
    isLoggedIn,
    fullName,

    // Actions
    login,
    logout,
    updatePreferences
  }
})

// Options API style store
export const useCounterStore = defineStore('counter', {
  state: () => ({
    count: 0,
    history: []
  }),

  getters: {
    doubleCount: (state) => state.count * 2,
    lastAction: (state) => state.history[state.history.length - 1]
  },

  actions: {
    increment() {
      this.count++
      this.history.push({ action: 'increment', timestamp: Date.now() })
    },

    decrement() {
      this.count--
      this.history.push({ action: 'decrement', timestamp: Date.now() })
    },

    reset() {
      this.count = 0
      this.history = []
    }
  }
})
      `;

      const result = await parser.parseFile('/src/stores/user.js', content);

      const storeEntities = result.frameworkEntities!.filter(e => e.type === 'store');
      expect(storeEntities).toHaveLength(2);

      const userStore = storeEntities.find(s => s.name === 'useUserStore');
      expect(userStore!.metadata.storeId).toBe('user');
      expect(userStore!.metadata.style).toBe('setup');
      expect(userStore!.metadata.state).toContain('user');
      expect(userStore!.metadata.getters).toContain('isLoggedIn');
      expect(userStore!.metadata.actions).toContain('login');

      const counterStore = storeEntities.find(s => s.name === 'useCounterStore');
      expect(counterStore!.metadata.style).toBe('options');
      expect(counterStore!.metadata.state).toContain('count');
    });
  });

  describe('error handling', () => {
    it('should handle malformed Vue SFC', async () => {
      const content = `
<template>
  <div>Unclosed tag
</template>

<script setup>
const invalid syntax here
</script>
      `;

      const result = await parser.parseFile('/src/Broken.vue', content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.frameworkEntities).toHaveLength(1); // Should still create component entry
      expect(result.frameworkEntities![0].name).toBe('Broken');
    });

    it('should handle non-Vue files gracefully', async () => {
      const content = `
export function regularFunction() {
  return 'Not a Vue file'
}
      `;

      const result = await parser.parseFile('/src/regular.js', content);

      expect(result.frameworkEntities).toHaveLength(0);
      expect(result.metadata.isFrameworkSpecific).toBe(false);
    });

    it('should handle empty Vue file', async () => {
      const content = '';

      const result = await parser.parseFile('/src/Empty.vue', content);

      expect(result.frameworkEntities).toHaveLength(1);
      expect(result.frameworkEntities![0].name).toBe('Empty');
      expect(result.frameworkEntities![0].metadata.hasTemplate).toBe(false);
      expect(result.frameworkEntities![0].metadata.hasScript).toBe(false);
    });
  });

  describe('Vue 3 Built-in Components', () => {
    it('should detect Teleport components', async () => {
      const content = `
<template>
  <div>
    <button @click="showModal = true">Open Modal</button>
    <Teleport to="body">
      <div v-if="showModal" class="modal">
        <p>This is rendered in document.body</p>
        <button @click="showModal = false">Close</button>
      </div>
    </Teleport>
    <teleport to="#modal-container">
      <div class="another-modal">Dynamic teleport</div>
    </teleport>
  </div>
</template>

<script setup>
import { ref } from 'vue'
const showModal = ref(false)
</script>
      `;

      const result = await parser.parseFile('/src/TeleportExample.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.builtInComponents).toContain('Teleport');
      expect(component.metadata.builtInComponents).toContain('teleport');
      expect(component.metadata.teleportTargets).toContain('body');
      expect(component.metadata.teleportTargets).toContain('#modal-container');
    });

    it('should detect Suspense components', async () => {
      const content = `
<template>
  <Suspense>
    <template #default>
      <AsyncComponent />
    </template>
    <template #fallback>
      <div>Loading...</div>
    </template>
  </Suspense>
  <suspense timeout="3000">
    <LazyComponent />
    <template #fallback>
      <Spinner />
    </template>
  </suspense>
</template>

<script setup>
import AsyncComponent from './AsyncComponent.vue'
import LazyComponent from './LazyComponent.vue'
</script>
      `;

      const result = await parser.parseFile('/src/SuspenseExample.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.builtInComponents).toContain('Suspense');
      expect(component.metadata.builtInComponents).toContain('suspense');
      expect(component.metadata.hasAsyncComponents).toBe(true);
    });

    it('should detect KeepAlive components', async () => {
      const content = `
<template>
  <KeepAlive :include="includePattern" :exclude="excludePattern">
    <component :is="currentComponent" />
  </KeepAlive>
  <keep-alive :max="10">
    <router-view />
  </keep-alive>
</template>

<script setup>
import { ref } from 'vue'
const currentComponent = ref('ComponentA')
const includePattern = ref(/^Cache/)
const excludePattern = ref(['ComponentB'])
</script>
      `;

      const result = await parser.parseFile('/src/KeepAliveExample.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.builtInComponents).toContain('KeepAlive');
      expect(component.metadata.builtInComponents).toContain('keep-alive');
      expect(component.metadata.hasCaching).toBe(true);
    });

    it('should detect Transition components', async () => {
      const content = `
<template>
  <Transition name="fade" mode="out-in" appear>
    <div v-if="show" key="content">Animated content</div>
  </Transition>
  <transition name="slide" @enter="onEnter" @leave="onLeave">
    <p v-show="visible">Slide animation</p>
  </transition>
  <TransitionGroup name="list" tag="ul">
    <li v-for="item in items" :key="item.id">{{ item.text }}</li>
  </TransitionGroup>
</template>

<script setup>
import { ref } from 'vue'
const show = ref(true)
const visible = ref(true)
const items = ref([{ id: 1, text: 'Item 1' }])

const onEnter = (el) => console.log('Enter')
const onLeave = (el) => console.log('Leave')
</script>
      `;

      const result = await parser.parseFile('/src/TransitionExample.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.builtInComponents).toContain('Transition');
      expect(component.metadata.builtInComponents).toContain('transition');
      expect(component.metadata.builtInComponents).toContain('TransitionGroup');
      expect(component.metadata.hasAnimations).toBe(true);
      expect(component.metadata.transitionNames).toContain('fade');
      expect(component.metadata.transitionNames).toContain('slide');
      expect(component.metadata.transitionNames).toContain('list');
    });
  });

  describe('Advanced Composition API', () => {
    it('should detect provide/inject pattern', async () => {
      const content = `
<template>
  <div>
    <ChildComponent />
  </div>
</template>

<script setup>
import { provide, inject, ref } from 'vue'
import ChildComponent from './ChildComponent.vue'

// Provide values
const theme = ref('dark')
provide('theme', theme)
provide('api', { get: () => {}, post: () => {} })
provide('userService', new UserService())

// Inject values (in child component scenario)
const injectedTheme = inject('theme', 'light')
const api = inject('api')
const config = inject('config', () => ({ debug: false }))
</script>
      `;

      const result = await parser.parseFile('/src/ProvideInject.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.providedKeys).toContain('theme');
      expect(component.metadata.providedKeys).toContain('api');
      expect(component.metadata.providedKeys).toContain('userService');
      expect(component.metadata.injectedKeys).toContain('theme');
      expect(component.metadata.injectedKeys).toContain('api');
      expect(component.metadata.injectedKeys).toContain('config');
      expect(component.metadata.hasProvideInject).toBe(true);
    });

    it('should detect defineExpose usage', async () => {
      const content = `
<template>
  <div ref="container">{{ count }}</div>
</template>

<script setup>
import { ref } from 'vue'

const count = ref(0)
const container = ref(null)

const increment = () => count.value++
const decrement = () => count.value--
const reset = () => count.value = 0
const getElement = () => container.value

// Expose methods to parent
defineExpose({
  increment,
  decrement,
  reset,
  getElement,
  count: readonly(count)
})
</script>
      `;

      const result = await parser.parseFile('/src/ExposedComponent.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.exposedMethods).toContain('increment');
      expect(component.metadata.exposedMethods).toContain('decrement');
      expect(component.metadata.exposedMethods).toContain('reset');
      expect(component.metadata.exposedMethods).toContain('getElement');
      expect(component.metadata.exposedProperties).toContain('count');
      expect(component.metadata.hasDefineExpose).toBe(true);
    });

    it('should detect defineModel usage', async () => {
      const content = `
<template>
  <div>
    <input v-model="modelValue" />
    <input v-model="username" />
    <select v-model="selectedOption">
      <option value="a">A</option>
      <option value="b">B</option>
    </select>
  </div>
</template>

<script setup>
const modelValue = defineModel()
const username = defineModel('username', { default: '' })
const selectedOption = defineModel('option', {
  default: 'a',
  validator: (value) => ['a', 'b'].includes(value)
})
</script>
      `;

      const result = await parser.parseFile('/src/ModelComponent.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.models).toContain('modelValue');
      expect(component.metadata.models).toContain('username');
      expect(component.metadata.models).toContain('option');
      expect(component.metadata.hasDefineModel).toBe(true);
    });
  });

  describe('Template Directive Analysis', () => {
    it('should detect built-in directives', async () => {
      const content = `
<template>
  <div>
    <p v-show="isVisible">Shown conditionally</p>
    <div v-if="condition" v-else-if="otherCondition" v-else>Conditional rendering</div>
    <ul>
      <li v-for="(item, index) in items" :key="item.id">{{ item.name }}</li>
    </ul>
    <input v-model="inputValue" v-focus v-tooltip="helpText" />
    <button v-on:click="handleClick" @mouseover="handleHover">Click me</button>
    <img v-bind:src="imageSrc" :alt="imageAlt" />
    <div v-html="rawHtml" v-text="plainText"></div>
    <form @submit.prevent="submitForm">
      <input v-model.lazy.trim="formData.name" />
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const isVisible = ref(true)
const condition = ref(false)
const otherCondition = ref(true)
const items = ref([{ id: 1, name: 'Item 1' }])
const inputValue = ref('')
const helpText = ref('Help text')
const imageSrc = ref('/image.jpg')
const imageAlt = ref('Alt text')
const rawHtml = ref('<strong>Bold</strong>')
const plainText = ref('Plain text')
const formData = ref({ name: '' })

const handleClick = () => {}
const handleHover = () => {}
const submitForm = () => {}
</script>
      `;

      const result = await parser.parseFile('/src/DirectiveExample.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.directives.builtin).toContain('v-show');
      expect(component.metadata.directives.builtin).toContain('v-if');
      expect(component.metadata.directives.builtin).toContain('v-for');
      expect(component.metadata.directives.builtin).toContain('v-model');
      expect(component.metadata.directives.builtin).toContain('v-on');
      expect(component.metadata.directives.builtin).toContain('v-bind');
      expect(component.metadata.directives.builtin).toContain('v-html');
      expect(component.metadata.directives.builtin).toContain('v-text');
      expect(component.metadata.directives.custom).toContain('v-focus');
      expect(component.metadata.directives.custom).toContain('v-tooltip');
      expect(component.metadata.eventHandlers).toContain('click');
      expect(component.metadata.eventHandlers).toContain('mouseover');
      expect(component.metadata.eventHandlers).toContain('submit');
    });
  });

  describe('Template Features', () => {
    it('should detect scoped slots', async () => {
      const content = `
<template>
  <div>
    <DataTable>
      <template #header="{ columns }">
        <tr>
          <th v-for="col in columns" :key="col.id">{{ col.title }}</th>
        </tr>
      </template>

      <template #default="{ row, index }">
        <tr>
          <td>{{ row.name }}</td>
          <td>{{ index }}</td>
        </tr>
      </template>

      <template #footer="{ total }">
        <div>Total: {{ total }}</div>
      </template>
    </DataTable>

    <CustomComponent>
      <template v-slot:content="{ data, loading }">
        <div v-if="loading">Loading...</div>
        <div v-else>{{ data }}</div>
      </template>
    </CustomComponent>
  </div>
</template>
      `;

      const result = await parser.parseFile('/src/ScopedSlots.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.scopedSlots).toContain('header');
      expect(component.metadata.scopedSlots).toContain('default');
      expect(component.metadata.scopedSlots).toContain('footer');
      expect(component.metadata.scopedSlots).toContain('content');
      expect(component.metadata.hasScopedSlots).toBe(true);
    });

    it('should detect dynamic components', async () => {
      const content = `
<template>
  <div>
    <component :is="currentComponent" :data="componentData" @event="handleEvent" />
    <component :is="tabs[activeTab].component" v-bind="tabs[activeTab].props" />
    <KeepAlive>
      <component :is="cachedComponent" :key="componentKey" />
    </KeepAlive>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import ComponentA from './ComponentA.vue'
import ComponentB from './ComponentB.vue'

const currentComponent = ref('ComponentA')
const componentData = ref({})
const activeTab = ref(0)
const componentKey = ref(0)

const tabs = ref([
  { component: ComponentA, props: {} },
  { component: ComponentB, props: {} }
])

const cachedComponent = computed(() => tabs.value[activeTab.value].component)

const handleEvent = () => {}
</script>
      `;

      const result = await parser.parseFile('/src/DynamicComponent.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.hasDynamicComponents).toBe(true);
      expect(component.metadata.dynamicComponentVariables).toContain('currentComponent');
      expect(component.metadata.dynamicComponentVariables).toContain('tabs[activeTab].component');
      expect(component.metadata.dynamicComponentVariables).toContain('cachedComponent');
    });

    it('should detect template refs', async () => {
      const content = `
<template>
  <div>
    <input ref="inputRef" v-model="inputValue" />
    <div ref="containerRef" class="container">
      <component ref="childRef" :is="currentComponent" />
    </div>
    <ul ref="listRef">
      <li v-for="item in items" :key="item.id" :ref="el => itemRefs[item.id] = el">
        {{ item.name }}
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const inputRef = ref(null)
const containerRef = ref(null)
const childRef = ref(null)
const listRef = ref(null)
const itemRefs = ref({})

const inputValue = ref('')
const currentComponent = ref('ComponentA')
const items = ref([{ id: 1, name: 'Item 1' }])

onMounted(() => {
  inputRef.value?.focus()
  console.log(containerRef.value)
})
</script>
      `;

      const result = await parser.parseFile('/src/TemplateRefs.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.templateRefs).toContain('inputRef');
      expect(component.metadata.templateRefs).toContain('containerRef');
      expect(component.metadata.templateRefs).toContain('childRef');
      expect(component.metadata.templateRefs).toContain('listRef');
      expect(component.metadata.hasTemplateRefs).toBe(true);
    });
  });

  describe('framework patterns', () => {
    it('should return correct framework patterns', () => {
      const patterns = parser.getFrameworkPatterns();

      expect(patterns.some(p => p.name === 'vue-sfc')).toBe(true);
      expect(patterns.some(p => p.name === 'vue-composable')).toBe(true);
      expect(patterns.some(p => p.name === 'vue-router')).toBe(true);
      expect(patterns.some(p => p.name === 'pinia-store')).toBe(true);
      expect(patterns.some(p => p.name === 'vue-built-in-components')).toBe(true);
      expect(patterns.some(p => p.name === 'vue-advanced-composition')).toBe(true);
      expect(patterns.some(p => p.name === 'vueuse-composables')).toBe(true);
      expect(patterns.some(p => p.name === 'vite-patterns')).toBe(true);
      expect(patterns.some(p => p.name === 'vue-testing')).toBe(true);

      const sfcPattern = patterns.find(p => p.name === 'vue-sfc');
      expect(sfcPattern!.fileExtensions).toContain('.vue');
      expect(sfcPattern!.confidence).toBeGreaterThan(0.8);

      const builtInPattern = patterns.find(p => p.name === 'vue-built-in-components');
      expect(builtInPattern!.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('VueUse Composables', () => {
    it('should detect VueUse composables usage', async () => {
      const content = `
<template>
  <div>
    <div>Mouse: {{ x }}, {{ y }}</div>
    <div>Window size: {{ width }} x {{ height }}</div>
    <div>Online: {{ isOnline }}</div>
    <div>Battery: {{ battery.level }}%</div>
    <input v-model="inputValue" ref="inputRef" />
    <div>{{ debouncedValue }}</div>
  </div>
</template>

<script setup>
import {
  useMouse,
  useWindowSize,
  useOnline,
  useBattery,
  useLocalStorage,
  useDebounce,
  useElementSize,
  useIntersectionObserver,
  useMediaQuery,
  usePermission,
  usePreferredDark,
  useClipboard,
  useFetch,
  useAsyncState
} from '@vueuse/core'
import { ref, watch } from 'vue'

const { x, y } = useMouse()
const { width, height } = useWindowSize()
const isOnline = useOnline()
const { battery } = useBattery()

const inputValue = ref('')
const debouncedValue = useDebounce(inputValue, 300)

const storedValue = useLocalStorage('my-key', 'default')
const inputRef = ref(null)
const { width: inputWidth } = useElementSize(inputRef)

const isLargeScreen = useMediaQuery('(min-width: 1024px)')
const isDark = usePreferredDark()
const { copy, copied } = useClipboard()

const { data, error, isFetching } = useFetch('/api/data')
const { state, isReady } = useAsyncState(async () => {
  return await fetchUserData()
}, null)

const cameraPermission = usePermission('camera')

useIntersectionObserver(inputRef, ([{ isIntersecting }]) => {
  console.log('Input is visible:', isIntersecting)
})
</script>
      `;

      const result = await parser.parseFile('/src/VueUseExample.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.vueUseComposables).toContain('useMouse');
      expect(component.metadata.vueUseComposables).toContain('useWindowSize');
      expect(component.metadata.vueUseComposables).toContain('useOnline');
      expect(component.metadata.vueUseComposables).toContain('useBattery');
      expect(component.metadata.vueUseComposables).toContain('useLocalStorage');
      expect(component.metadata.vueUseComposables).toContain('useDebounce');
      expect(component.metadata.vueUseComposables).toContain('useElementSize');
      expect(component.metadata.vueUseComposables).toContain('useIntersectionObserver');
      expect(component.metadata.vueUseComposables).toContain('useMediaQuery');
      expect(component.metadata.vueUseComposables).toContain('usePermission');
      expect(component.metadata.vueUseComposables).toContain('usePreferredDark');
      expect(component.metadata.vueUseComposables).toContain('useClipboard');
      expect(component.metadata.vueUseComposables).toContain('useFetch');
      expect(component.metadata.vueUseComposables).toContain('useAsyncState');
      expect(component.metadata.hasVueUse).toBe(true);

      expect(result.imports.some(i => i.source === '@vueuse/core')).toBe(true);
    });

    it('should detect VueUse head composables', async () => {
      const content = `
<script setup>
import { useHead, useSeoMeta, useServerHead } from '@vueuse/head'
import { ref } from 'vue'

const title = ref('My Page')
const description = ref('Page description')

useHead({
  title: title,
  meta: [
    { name: 'description', content: description },
    { name: 'keywords', content: 'vue, vueuse' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ]
})

useSeoMeta({
  title: 'SEO Title',
  ogTitle: 'Open Graph Title',
  description: 'SEO Description',
  ogDescription: 'Open Graph Description',
  ogImage: '/og-image.jpg'
})

useServerHead({
  script: [
    { src: '/analytics.js', async: true }
  ]
})
</script>
      `;

      const result = await parser.parseFile('/src/HeadExample.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.vueUseComposables).toContain('useHead');
      expect(component.metadata.vueUseComposables).toContain('useSeoMeta');
      expect(component.metadata.vueUseComposables).toContain('useServerHead');
      expect(result.imports.some(i => i.source === '@vueuse/head')).toBe(true);
    });
  });

  describe('Vite Patterns', () => {
    it('should detect import.meta.glob patterns', async () => {
      const content = `
<script setup>
const modules = import.meta.glob('./modules/*.js')
const eagerModules = import.meta.glob('./components/*.vue', { eager: true })
const jsonFiles = import.meta.glob('/data/*.json', { as: 'raw' })
const asyncModules = import.meta.glob('./pages/*.vue', { import: 'default' })

const dynamicImports = import.meta.glob('./features/**/index.js', {
  eager: false,
  import: 'default'
})
</script>
      `;

      const result = await parser.parseFile('/src/ViteGlob.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.vitePatterns.globImports).toContain('./modules/*.js');
      expect(component.metadata.vitePatterns.globImports).toContain('./components/*.vue');
      expect(component.metadata.vitePatterns.globImports).toContain('/data/*.json');
      expect(component.metadata.vitePatterns.globImports).toContain('./pages/*.vue');
      expect(component.metadata.vitePatterns.globImports).toContain('./features/**/index.js');
      expect(component.metadata.vitePatterns.hasGlobImports).toBe(true);
    });

    it('should detect import.meta.env usage', async () => {
      const content = `
<script setup>
const apiUrl = import.meta.env.VITE_API_URL
const isDev = import.meta.env.DEV
const isProd = import.meta.env.PROD
const mode = import.meta.env.MODE
const baseUrl = import.meta.env.BASE_URL
const customVar = import.meta.env.VITE_CUSTOM_VAR

const config = {
  api: import.meta.env.VITE_API_ENDPOINT,
  debug: import.meta.env.VITE_DEBUG === 'true',
  version: import.meta.env.VITE_APP_VERSION
}
</script>
      `;

      const result = await parser.parseFile('/src/ViteEnv.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.vitePatterns.envVariables).toContain('VITE_API_URL');
      expect(component.metadata.vitePatterns.envVariables).toContain('DEV');
      expect(component.metadata.vitePatterns.envVariables).toContain('PROD');
      expect(component.metadata.vitePatterns.envVariables).toContain('MODE');
      expect(component.metadata.vitePatterns.envVariables).toContain('BASE_URL');
      expect(component.metadata.vitePatterns.envVariables).toContain('VITE_CUSTOM_VAR');
      expect(component.metadata.vitePatterns.envVariables).toContain('VITE_API_ENDPOINT');
      expect(component.metadata.vitePatterns.envVariables).toContain('VITE_DEBUG');
      expect(component.metadata.vitePatterns.envVariables).toContain('VITE_APP_VERSION');
      expect(component.metadata.vitePatterns.hasEnvVariables).toBe(true);
    });
  });

  describe('Styling Features', () => {
    it('should detect CSS Modules usage', async () => {
      const content = `
<template>
  <div :class="$style.container">
    <h1 :class="[$style.title, $style.primary]">Title</h1>
    <p :class="$style['error-message']">Error</p>
  </div>
</template>

<style module>
.container {
  padding: 20px;
}

.title {
  font-size: 24px;
}

.primary {
  color: blue;
}

.error-message {
  color: red;
}
</style>
      `;

      const result = await parser.parseFile('/src/CSSModules.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.styling.cssModules).toContain('container');
      expect(component.metadata.styling.cssModules).toContain('title');
      expect(component.metadata.styling.cssModules).toContain('primary');
      expect(component.metadata.styling.cssModules).toContain('error-message');
      expect(component.metadata.styling.hasCSSModules).toBe(true);
    });

    it('should detect CSS preprocessors', async () => {
      const content = `
<template>
  <div class="scss-component">
    <div class="nested-element">Content</div>
  </div>
</template>

<style lang="scss" scoped>
$primary-color: #3498db;
$border-radius: 4px;

.scss-component {
  background: $primary-color;
  border-radius: $border-radius;

  .nested-element {
    padding: 10px;

    &:hover {
      opacity: 0.8;
    }
  }
}
</style>

<style lang="less">
@import 'variables.less';

.global-styles {
  .mixin-usage {
    .border-radius(5px);
  }
}
</style>
      `;

      const result = await parser.parseFile('/src/Preprocessors.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.styling.preprocessors).toContain('scss');
      expect(component.metadata.styling.preprocessors).toContain('less');
      expect(component.metadata.styling.hasPreprocessors).toBe(true);
      expect(component.metadata.styling.scoped).toBe(true);
      expect(component.metadata.styling.variables).toContain('$primary-color');
      expect(component.metadata.styling.variables).toContain('$border-radius');
      expect(component.metadata.styling.variables).toContain('@import');
    });

    it('should detect CSS-in-JS and dynamic styling', async () => {
      const content = `
<template>
  <div :style="dynamicStyles" :class="computedClasses">
    <span :style="{ color: textColor, fontSize: fontSize + 'px' }">Text</span>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const theme = ref('dark')
const isActive = ref(true)
const textColor = ref('#333')
const fontSize = ref(16)

const dynamicStyles = computed(() => ({
  backgroundColor: theme.value === 'dark' ? '#333' : '#fff',
  border: isActive.value ? '2px solid blue' : 'none',
  padding: '10px',
  borderRadius: '4px'
}))

const computedClasses = computed(() => ({
  'theme-dark': theme.value === 'dark',
  'theme-light': theme.value === 'light',
  'is-active': isActive.value,
  'is-inactive': !isActive.value
}))
</script>
      `;

      const result = await parser.parseFile('/src/DynamicStyling.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.styling.hasDynamicStyling).toBe(true);
      expect(component.metadata.styling.dynamicStyleVariables).toContain('dynamicStyles');
      expect(component.metadata.styling.dynamicStyleVariables).toContain('computedClasses');
      expect(component.metadata.styling.dynamicStyleVariables).toContain('textColor');
      expect(component.metadata.styling.dynamicStyleVariables).toContain('fontSize');
    });
  });

  describe('TypeScript Integration', () => {
    it('should detect TypeScript interfaces and types', async () => {
      const content = `
<template>
  <div>
    <UserCard :user="user" @update="handleUpdate" />
    <GenericList :items="items" :render-item="renderUser" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PropType } from 'vue'

interface User {
  id: number
  name: string
  email: string
  profile?: UserProfile
}

interface UserProfile {
  avatar: string
  bio: string
}

type UserAction = 'create' | 'update' | 'delete'
type ApiResponse<T> = {
  data: T
  status: number
  message: string
}

interface ComponentProps {
  users: User[]
  loading?: boolean
  onAction?: (action: UserAction, user: User) => void
}

const props = defineProps<ComponentProps>()
const emit = defineEmits<{
  update: [user: User]
  delete: [id: number]
  action: [action: UserAction, data: unknown]
}>()

const user = ref<User>({
  id: 1,
  name: 'John Doe',
  email: 'john@example.com'
})

const items = ref<User[]>([])

const apiResponse = ref<ApiResponse<User[]> | null>(null)

const renderUser = (user: User): string => {
  return \`\${user.name} (\${user.email})\`
}

const handleUpdate = (updatedUser: User): void => {
  emit('update', updatedUser)
}

const genericFunction = <T>(data: T): T => {
  return data
}
</script>
      `;

      const result = await parser.parseFile('/src/TypeScriptComponent.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.typescript.interfaces).toContain('User');
      expect(component.metadata.typescript.interfaces).toContain('UserProfile');
      expect(component.metadata.typescript.interfaces).toContain('ComponentProps');
      expect(component.metadata.typescript.types).toContain('UserAction');
      expect(component.metadata.typescript.types).toContain('ApiResponse');
      expect(component.metadata.typescript.hasTypeScript).toBe(true);
      expect(component.metadata.typescript.hasGenerics).toBe(true);
      expect(component.metadata.typescript.genericFunctions).toContain('genericFunction');

      expect(result.symbols.some(s => s.name === 'User' && s.symbol_type === 'interface')).toBe(true);
      expect(result.symbols.some(s => s.name === 'UserProfile' && s.symbol_type === 'interface')).toBe(true);
      expect(result.symbols.some(s => s.name === 'UserAction' && s.symbol_type === 'type_alias')).toBe(true);
    });

    it('should detect TypeScript utility types', async () => {
      const content = `
<script setup lang="ts">
interface BaseUser {
  id: number
  name: string
  email: string
  role: 'admin' | 'user' | 'guest'
}

type PartialUser = Partial<BaseUser>
type RequiredUser = Required<BaseUser>
type UserKeys = keyof BaseUser
type UserEmail = Pick<BaseUser, 'email'>
type UserWithoutId = Omit<BaseUser, 'id'>
type UserRole = BaseUser['role']

type UserRecord = Record<string, BaseUser>
type UserArray = Array<BaseUser>
type UserPromise = Promise<BaseUser>

const partialUser: PartialUser = { name: 'John' }
const userRecord: UserRecord = {}
const users: UserArray = []

const fetchUser = async (): UserPromise => {
  return { id: 1, name: 'John', email: 'john@test.com', role: 'user' }
}
</script>
      `;

      const result = await parser.parseFile('/src/UtilityTypes.vue', content);

      const component = result.frameworkEntities![0];
      expect(component.metadata.typescript.utilityTypes).toContain('Partial');
      expect(component.metadata.typescript.utilityTypes).toContain('Required');
      expect(component.metadata.typescript.utilityTypes).toContain('Pick');
      expect(component.metadata.typescript.utilityTypes).toContain('Omit');
      expect(component.metadata.typescript.utilityTypes).toContain('Record');
      expect(component.metadata.typescript.utilityTypes).toContain('Array');
      expect(component.metadata.typescript.utilityTypes).toContain('Promise');
      expect(component.metadata.typescript.hasUtilityTypes).toBe(true);
    });
  });
});