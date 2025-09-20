<template>
  <div class="user-list">
    <div class="header">
      <h2>User Management</h2>
      <button @click="showCreateForm = !showCreateForm" class="btn-primary">
        {{ showCreateForm ? 'Cancel' : 'Add User' }}
      </button>
    </div>

    <!-- Create User Form -->
    <div v-if="showCreateForm" class="create-form">
      <h3>Create New User</h3>
      <form @submit.prevent="handleCreateUser">
        <div class="form-group">
          <label for="name">Name:</label>
          <input
            id="name"
            v-model="newUser.name"
            type="text"
            required
            maxlength="255"
          />
        </div>
        <div class="form-group">
          <label for="email">Email:</label>
          <input
            id="email"
            v-model="newUser.email"
            type="email"
            required
          />
        </div>
        <div class="form-actions">
          <button type="submit" :disabled="loading">
            {{ loading ? 'Creating...' : 'Create User' }}
          </button>
          <button type="button" @click="resetForm">Reset</button>
        </div>
      </form>
    </div>

    <!-- User List -->
    <div class="users-grid">
      <div v-if="loading && users.length === 0" class="loading">
        Loading users...
      </div>

      <div v-else-if="users.length === 0" class="empty-state">
        No users found. Create your first user!
      </div>

      <div v-else>
        <div class="users-header">
          <span>Found {{ totalUsers }} users</span>
          <button @click="refreshUsers" class="btn-secondary">Refresh</button>
        </div>

        <div class="user-grid">
          <div
            v-for="user in users"
            :key="user.id"
            class="user-card"
            @click="selectUser(user)"
          >
            <div class="user-info">
              <h4>{{ user.name }}</h4>
              <p>{{ user.email }}</p>
              <small>Created: {{ formatDate(user.created_at) }}</small>
            </div>
            <div class="user-actions">
              <button
                @click.stop="editUser(user)"
                class="btn-edit"
                title="Edit user"
              >
                Edit
              </button>
              <button
                @click.stop="confirmDeleteUser(user)"
                class="btn-delete"
                title="Delete user"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="meta.total > meta.per_page" class="pagination">
          <button
            @click="loadPage(meta.current_page - 1)"
            :disabled="meta.current_page <= 1"
          >
            Previous
          </button>
          <span>Page {{ meta.current_page }} of {{ totalPages }}</span>
          <button
            @click="loadPage(meta.current_page + 1)"
            :disabled="meta.current_page >= totalPages"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { User, CreateUserRequest, UserListResponse } from '../types/User';

// Component state
const users = ref<User[]>([]);
const loading = ref(false);
const showCreateForm = ref(false);
const newUser = ref<CreateUserRequest>({
  name: '',
  email: ''
});

const meta = ref({
  total: 0,
  per_page: 15,
  current_page: 1
});

// Computed properties
const totalUsers = computed(() => meta.value.total);
const totalPages = computed(() => Math.ceil(meta.value.total / meta.value.per_page));

// Emits
const emit = defineEmits<{
  userSelected: [user: User];
  userEdited: [user: User];
}>();

/**
 * API call to fetch users with pagination
 */
const fetchUsers = async (page: number = 1): Promise<UserListResponse> => {
  const response = await fetch(`/api/users?page=${page}&per_page=${meta.value.per_page}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.statusText}`);
  }

  return response.json();
};

/**
 * API call to create a new user
 */
const createUser = async (userData: CreateUserRequest): Promise<User> => {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(userData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to create user: ${response.statusText}`);
  }

  return response.json();
};

/**
 * API call to delete a user
 */
const deleteUser = async (userId: number): Promise<void> => {
  const response = await fetch(`/api/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to delete user: ${response.statusText}`);
  }
};

// Event handlers
const loadUsers = async (page: number = 1) => {
  try {
    loading.value = true;
    const response = await fetchUsers(page);
    users.value = response.data;
    meta.value = response.meta;
  } catch (error) {
    console.error('Error loading users:', error);
    // In a real app, you'd show a toast/notification
  } finally {
    loading.value = false;
  }
};

const loadPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    loadUsers(page);
  }
};

const refreshUsers = () => {
  loadUsers(meta.value.current_page);
};

const handleCreateUser = async () => {
  try {
    loading.value = true;
    const user = await createUser(newUser.value);

    // Add to current list if we're on the first page
    if (meta.value.current_page === 1) {
      users.value.unshift(user);
      meta.value.total += 1;
    }

    resetForm();
    showCreateForm.value = false;
  } catch (error) {
    console.error('Error creating user:', error);
    // In a real app, you'd show error message
  } finally {
    loading.value = false;
  }
};

const confirmDeleteUser = async (user: User) => {
  if (confirm(`Are you sure you want to delete ${user.name}?`)) {
    try {
      await deleteUser(user.id);
      users.value = users.value.filter(u => u.id !== user.id);
      meta.value.total -= 1;
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  }
};

const selectUser = (user: User) => {
  emit('userSelected', user);
};

const editUser = (user: User) => {
  emit('userEdited', user);
};

const resetForm = () => {
  newUser.value = {
    name: '',
    email: ''
  };
};

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString();
};

// Lifecycle
onMounted(() => {
  loadUsers();
});
</script>

<style scoped>
.user-list {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.create-form {
  background: #f5f5f5;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 30px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.form-actions {
  display: flex;
  gap: 10px;
}

.users-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.user-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.user-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: box-shadow 0.2s;
}

.user-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.user-info h4 {
  margin: 0 0 8px 0;
  color: #333;
}

.user-info p {
  margin: 0 0 8px 0;
  color: #666;
}

.user-info small {
  color: #999;
}

.user-actions {
  display: flex;
  gap: 8px;
  margin-top: 15px;
}

.btn-primary, .btn-secondary, .btn-edit, .btn-delete {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-edit {
  background: #28a745;
  color: white;
}

.btn-delete {
  background: #dc3545;
  color: white;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  margin-top: 30px;
}

.loading, .empty-state {
  text-align: center;
  padding: 40px;
  color: #666;
}
</style>