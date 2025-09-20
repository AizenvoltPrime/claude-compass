<template>
  <div class="user-profile">
    <div class="profile-header">
      <h2>User Profile</h2>
      <div class="header-actions">
        <button v-if="!editMode" @click="toggleEditMode" class="btn-edit">
          Edit Profile
        </button>
        <button v-if="editMode" @click="cancelEdit" class="btn-secondary">
          Cancel
        </button>
        <button @click="$emit('close')" class="btn-close">
          Close
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading">
      Loading user profile...
    </div>

    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="loadUser" class="btn-primary">Retry</button>
    </div>

    <div v-else-if="user" class="profile-content">
      <!-- View Mode -->
      <div v-if="!editMode" class="view-mode">
        <div class="profile-section">
          <h3>Basic Information</h3>
          <div class="info-grid">
            <div class="info-item">
              <label>ID:</label>
              <span>{{ user.id }}</span>
            </div>
            <div class="info-item">
              <label>Name:</label>
              <span>{{ user.name }}</span>
            </div>
            <div class="info-item">
              <label>Email:</label>
              <span>{{ user.email }}</span>
            </div>
            <div class="info-item">
              <label>Created:</label>
              <span>{{ formatDateTime(user.created_at) }}</span>
            </div>
            <div class="info-item">
              <label>Updated:</label>
              <span>{{ formatDateTime(user.updated_at) }}</span>
            </div>
          </div>
        </div>

        <div class="profile-actions">
          <button @click="refreshUser" class="btn-secondary">
            Refresh
          </button>
          <button @click="confirmDeleteUser" class="btn-delete">
            Delete User
          </button>
        </div>
      </div>

      <!-- Edit Mode -->
      <div v-else class="edit-mode">
        <form @submit.prevent="handleUpdateUser">
          <div class="profile-section">
            <h3>Edit User Information</h3>
            <div class="form-grid">
              <div class="form-group">
                <label for="edit-name">Name:</label>
                <input
                  id="edit-name"
                  v-model="editForm.name"
                  type="text"
                  required
                  maxlength="255"
                  :disabled="updating"
                />
                <small>Required, maximum 255 characters</small>
              </div>

              <div class="form-group">
                <label for="edit-email">Email:</label>
                <input
                  id="edit-email"
                  v-model="editForm.email"
                  type="email"
                  required
                  :disabled="updating"
                />
                <small>Required, must be a valid email address</small>
              </div>
            </div>

            <div class="form-actions">
              <button
                type="submit"
                :disabled="updating || !isFormValid"
                class="btn-primary"
              >
                {{ updating ? 'Updating...' : 'Update User' }}
              </button>
              <button
                type="button"
                @click="resetForm"
                :disabled="updating"
                class="btn-secondary"
              >
                Reset
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <div v-else class="no-user">
      No user data available
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { User, UpdateUserRequest } from '../types/User';

// Props
interface Props {
  userId: number;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  close: [];
  userUpdated: [user: User];
  userDeleted: [userId: number];
}>();

// Component state
const user = ref<User | null>(null);
const loading = ref(false);
const updating = ref(false);
const error = ref<string | null>(null);
const editMode = ref(false);

const editForm = ref<UpdateUserRequest>({
  name: '',
  email: ''
});

// Computed properties
const isFormValid = computed(() => {
  return editForm.value.name.trim().length > 0 &&
         editForm.value.email.trim().length > 0 &&
         /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.value.email);
});

/**
 * API call to fetch specific user
 */
const fetchUser = async (id: number): Promise<User> => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('User not found');
    }
    throw new Error(`Failed to fetch user: ${response.statusText}`);
  }

  return response.json();
};

/**
 * API call to update user
 */
const updateUser = async (id: number, userData: UpdateUserRequest): Promise<User> => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(userData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 422) {
      throw new Error(errorData.message || 'Validation error');
    }
    if (response.status === 404) {
      throw new Error('User not found');
    }
    throw new Error(errorData.message || `Failed to update user: ${response.statusText}`);
  }

  return response.json();
};

/**
 * API call to delete user
 */
const deleteUser = async (id: number): Promise<void> => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('User not found');
    }
    throw new Error(`Failed to delete user: ${response.statusText}`);
  }
};

// Event handlers
const loadUser = async () => {
  try {
    loading.value = true;
    error.value = null;
    user.value = await fetchUser(props.userId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load user';
    user.value = null;
  } finally {
    loading.value = false;
  }
};

const refreshUser = () => {
  loadUser();
};

const toggleEditMode = () => {
  if (!editMode.value && user.value) {
    // Entering edit mode - populate form
    editForm.value = {
      name: user.value.name,
      email: user.value.email
    };
  }
  editMode.value = !editMode.value;
};

const cancelEdit = () => {
  editMode.value = false;
  resetForm();
};

const resetForm = () => {
  if (user.value) {
    editForm.value = {
      name: user.value.name,
      email: user.value.email
    };
  }
};

const handleUpdateUser = async () => {
  if (!user.value || !isFormValid.value) return;

  try {
    updating.value = true;
    const updatedUser = await updateUser(user.value.id, editForm.value);
    user.value = updatedUser;
    editMode.value = false;
    emit('userUpdated', updatedUser);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update user';
  } finally {
    updating.value = false;
  }
};

const confirmDeleteUser = async () => {
  if (!user.value) return;

  const confirmed = confirm(
    `Are you sure you want to delete ${user.value.name}?\n\nThis action cannot be undone.`
  );

  if (confirmed) {
    try {
      await deleteUser(user.value.id);
      emit('userDeleted', user.value.id);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete user';
    }
  }
};

// Utility functions
const formatDateTime = (dateString: string): string => {
  return new Date(dateString).toLocaleString();
};

// Watchers
watch(() => props.userId, (newUserId) => {
  if (newUserId) {
    editMode.value = false;
    loadUser();
  }
}, { immediate: false });

// Lifecycle
onMounted(() => {
  if (props.userId) {
    loadUser();
  }
});
</script>

<style scoped>
.user-profile {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.profile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid #e0e0e0;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.profile-content {
  min-height: 300px;
}

.profile-section {
  margin-bottom: 30px;
}

.profile-section h3 {
  margin-bottom: 20px;
  color: #333;
  border-bottom: 2px solid #f0f0f0;
  padding-bottom: 10px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 15px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.info-item label {
  font-weight: 600;
  color: #555;
  font-size: 14px;
}

.info-item span {
  color: #333;
  padding: 8px 0;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-weight: 600;
  color: #555;
}

.form-group input {
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
}

.form-group input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
}

.form-group input:disabled {
  background-color: #f8f9fa;
  cursor: not-allowed;
}

.form-group small {
  color: #666;
  font-size: 12px;
}

.form-actions, .profile-actions {
  display: flex;
  gap: 15px;
  margin-top: 20px;
}

.btn-primary, .btn-secondary, .btn-edit, .btn-delete, .btn-close {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0056b3;
}

.btn-primary:disabled {
  background: #6c757d;
  cursor: not-allowed;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-secondary:hover {
  background: #545b62;
}

.btn-edit {
  background: #28a745;
  color: white;
}

.btn-edit:hover {
  background: #1e7e34;
}

.btn-delete {
  background: #dc3545;
  color: white;
}

.btn-delete:hover {
  background: #c82333;
}

.btn-close {
  background: #f8f9fa;
  color: #333;
  border: 1px solid #dee2e6;
}

.btn-close:hover {
  background: #e2e6ea;
}

.loading, .error, .no-user {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.error {
  color: #dc3545;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
}

@media (max-width: 768px) {
  .profile-header {
    flex-direction: column;
    gap: 15px;
    align-items: stretch;
  }

  .header-actions {
    justify-content: center;
  }

  .info-grid {
    grid-template-columns: 1fr;
  }

  .form-actions, .profile-actions {
    flex-direction: column;
  }
}
</style>