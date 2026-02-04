/**
 * Todoist API Module
 * Handles OAuth authentication and API interactions with Todoist
 */

// =============================================================================
// CONFIGURATION
// Credentials are stored in chrome.storage.local.todoistCredentials
// Users must configure these in the extension settings page
// =============================================================================

const TODOIST_AUTH_URL = 'https://todoist.com/oauth/authorize';
const TODOIST_TOKEN_URL = 'https://todoist.com/oauth/access_token';
const TODOIST_API_BASE = 'https://api.todoist.com/api/v1';

/**
 * Get stored Todoist credentials
 * @returns {Promise<{clientId: string, clientSecret: string}|null>}
 */
async function getCredentials() {
  const result = await chrome.storage.local.get('todoistCredentials');
  return result.todoistCredentials || null;
}

/**
 * Check if credentials are configured
 * @returns {Promise<boolean>}
 */
export async function hasCredentials() {
  const creds = await getCredentials();
  return creds !== null && creds.clientId && creds.clientSecret;
}

/**
 * Get the OAuth redirect URL for this extension
 * @returns {string} The redirect URL
 */
export function getRedirectURL() {
  return chrome.identity.getRedirectURL();
}

/**
 * Generate a random state string for CSRF protection
 * @returns {string} Random state string
 */
function generateState() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Initiate OAuth flow with Todoist
 * @returns {Promise<string>} The access token
 */
export async function authenticate() {
  const creds = await getCredentials();
  
  if (!creds || !creds.clientId || !creds.clientSecret) {
    throw new Error('Todoist credentials not configured. Please add your Client ID and Secret in settings.');
  }
  
  const state = generateState();
  const redirectUrl = getRedirectURL();

  const authUrl = new URL(TODOIST_AUTH_URL);
  authUrl.searchParams.set('client_id', creds.clientId);
  authUrl.searchParams.set('scope', 'data:read_write');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', redirectUrl);

  try {
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });

    // Parse the response URL to get the authorization code
    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    // Verify state to prevent CSRF
    if (returnedState !== state) {
      throw new Error('State mismatch - possible CSRF attack');
    }

    if (!code) {
      throw new Error('No authorization code received');
    }

    // Exchange authorization code for access token
    const token = await exchangeCodeForToken(code, creds);

    // Store the token
    await chrome.storage.local.set({ todoistToken: token });

    return token;
  } catch (error) {
    console.error('OAuth error:', error);
    throw error;
  }
}

/**
 * Exchange authorization code for access token
 * @param {string} code - The authorization code
 * @param {{clientId: string, clientSecret: string}} creds - The credentials
 * @returns {Promise<string>} The access token
 */
async function exchangeCodeForToken(code, creds) {
  const response = await fetch(TODOIST_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code: code,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Get the stored access token
 * @returns {Promise<string|null>} The access token or null if not authenticated
 */
export async function getToken() {
  const result = await chrome.storage.local.get('todoistToken');
  return result.todoistToken || null;
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>} True if authenticated
 */
export async function isAuthenticated() {
  const token = await getToken();
  return token !== null;
}

/**
 * Log out - remove stored token
 * @returns {Promise<void>}
 */
export async function logout() {
  await chrome.storage.local.remove('todoistToken');
}

/**
 * Make an authenticated API request to Todoist
 * @param {string} endpoint - API endpoint (e.g., '/tasks')
 * @param {object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
async function apiRequest(endpoint, options = {}) {
  const token = await getToken();

  if (!token) {
    throw new Error('Not authenticated with Todoist');
  }

  const url = `${TODOIST_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Token expired or invalid, clear it
    await logout();
    throw new Error('Authentication expired. Please log in again.');
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API request failed: ${error}`);
  }

  // Some endpoints return 204 No Content
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * Fetch all active tasks
 * @param {object} options - Optional filters
 * @param {string} options.projectId - Filter by project ID
 * @param {string} options.filter - Filter string (e.g., 'today', 'overdue')
 * @returns {Promise<Array>} Array of tasks
 */
export async function getTasks(options = {}) {
  const params = new URLSearchParams();

  if (options.projectId) {
    params.set('project_id', options.projectId);
  }
  if (options.filter) {
    params.set('filter', options.filter);
  }

  const queryString = params.toString();
  const endpoint = `/tasks${queryString ? `?${queryString}` : ''}`;

  const response = await apiRequest(endpoint);
  
  // Handle new API v1 paginated response format
  // The new API returns { results: [...tasks], next_cursor: ... }
  if (response && typeof response === 'object' && Array.isArray(response.results)) {
    return response.results;
  }
  
  // Fallback for direct array response (backward compatibility)
  if (Array.isArray(response)) {
    return response;
  }
  
  // If response is neither, return empty array to avoid iteration errors
  console.warn('Unexpected tasks response format:', response);
  return [];
}

/**
 * Fetch all tasks and organize with subtasks
 * @param {object} options - Optional filters
 * @returns {Promise<Array>} Array of tasks with subtasks nested
 */
export async function getTasksWithSubtasks(options = {}) {
  const allTasks = await getTasks(options);
  
  // Separate parent tasks and subtasks
  const parentTasks = [];
  const subtaskMap = new Map(); // parent_id -> subtasks[]
  
  for (const task of allTasks) {
    if (task.parent_id) {
      // This is a subtask
      if (!subtaskMap.has(task.parent_id)) {
        subtaskMap.set(task.parent_id, []);
      }
      subtaskMap.get(task.parent_id).push(task);
    } else {
      // This is a parent task
      parentTasks.push(task);
    }
  }
  
  // Attach subtasks to their parents
  for (const task of parentTasks) {
    task.subtasks = subtaskMap.get(task.id) || [];
    // Sort subtasks by order
    task.subtasks.sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  
  return parentTasks;
}

/**
 * Get a single task by ID
 * @param {string} taskId - The task ID
 * @returns {Promise<object>} The task object
 */
export async function getTask(taskId) {
  return apiRequest(`/tasks/${taskId}`);
}

/**
 * Complete (close) a task
 * @param {string} taskId - The task ID
 * @returns {Promise<void>}
 */
export async function completeTask(taskId) {
  return apiRequest(`/tasks/${taskId}/close`, {
    method: 'POST',
  });
}

/**
 * Reopen a task
 * @param {string} taskId - The task ID
 * @returns {Promise<void>}
 */
export async function reopenTask(taskId) {
  return apiRequest(`/tasks/${taskId}/reopen`, {
    method: 'POST',
  });
}

/**
 * Create a new task
 * @param {object} task - Task data
 * @param {string} task.content - Task content (required)
 * @param {string} task.description - Task description
 * @param {string} task.due_string - Natural language due date (e.g., 'tomorrow')
 * @param {number} task.priority - Priority 1-4 (4 is highest)
 * @returns {Promise<object>} The created task
 */
export async function createTask(task) {
  return apiRequest('/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

/**
 * Get all projects
 * @returns {Promise<Array>} Array of projects
 */
export async function getProjects() {
  const response = await apiRequest('/projects');
  
  // Handle new API v1 paginated response format
  if (response && typeof response === 'object' && Array.isArray(response.results)) {
    return response.results;
  }
  
  // Fallback for direct array response
  if (Array.isArray(response)) {
    return response;
  }
  
  console.warn('Unexpected projects response format:', response);
  return [];
}

/**
 * Get all labels
 * @returns {Promise<Array>} Array of labels with id, name, color
 */
export async function getLabels() {
  const response = await apiRequest('/labels');
  
  // Handle new API v1 paginated response format
  if (response && typeof response === 'object' && Array.isArray(response.results)) {
    return response.results;
  }
  
  // Fallback for direct array response
  if (Array.isArray(response)) {
    return response;
  }
  
  console.warn('Unexpected labels response format:', response);
  return [];
}

// Cache for labels (id/name -> label object)
let labelsCache = null;
let labelsCacheTime = 0;
const LABELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get labels as a map for quick lookup
 * @returns {Promise<Map<string, object>>} Map of label name to label object
 */
export async function getLabelsMap() {
  const now = Date.now();
  
  // Return cached if still valid
  if (labelsCache && (now - labelsCacheTime) < LABELS_CACHE_TTL) {
    return labelsCache;
  }
  
  try {
    const labels = await getLabels();
    labelsCache = new Map();
    
    for (const label of labels) {
      // Map by name (lowercase for case-insensitive lookup)
      labelsCache.set(label.name.toLowerCase(), label);
    }
    
    labelsCacheTime = now;
    return labelsCache;
  } catch (error) {
    console.error('Failed to fetch labels:', error);
    // Return empty map on error
    return new Map();
  }
}

/**
 * Format a task's due date for display
 * @param {object} task - The task object
 * @returns {string} Formatted due date string
 */
export function formatDueDate(task) {
  if (!task.due) {
    return '';
  }

  const due = task.due;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let dueDate;
  if (due.datetime) {
    dueDate = new Date(due.datetime);
  } else if (due.date) {
    dueDate = new Date(due.date + 'T00:00:00');
  } else {
    return due.string || '';
  }

  const dueDateOnly = new Date(dueDate);
  dueDateOnly.setHours(0, 0, 0, 0);

  // Check if overdue
  if (dueDateOnly < today) {
    return 'Overdue';
  }

  // Check if today
  if (dueDateOnly.getTime() === today.getTime()) {
    if (due.datetime) {
      return `Today ${dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return 'Today';
  }

  // Check if tomorrow
  if (dueDateOnly.getTime() === tomorrow.getTime()) {
    if (due.datetime) {
      return `Tomorrow ${dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return 'Tomorrow';
  }

  // Return formatted date
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  return dueDate.toLocaleDateString(undefined, options);
}

/**
 * Get priority color class
 * @param {number} priority - Priority 1-4
 * @returns {string} CSS class name
 */
export function getPriorityClass(priority) {
  switch (priority) {
    case 4: return 'priority-urgent';
    case 3: return 'priority-high';
    case 2: return 'priority-medium';
    default: return 'priority-normal';
  }
}
