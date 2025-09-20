# Vue-Laravel Sample Project - Test Fixtures

This directory contains test fixtures for validating Vue ↔ Laravel cross-stack dependency tracking functionality.

## Project Structure

This sample project demonstrates common patterns found in Vue.js + Laravel applications:

### Frontend (Vue.js)
- **Components**: Vue SFC components with API calls to Laravel backend
- **Types**: TypeScript interfaces for data contracts
- **API Integration**: Realistic HTTP client usage patterns

### Backend (Laravel)
- **Controllers**: API controllers with proper request/response handling
- **Models**: Eloquent models with fillable attributes and casts
- **Form Requests**: Validation classes with rules matching frontend types
- **Routes**: API routes connecting controllers to endpoints

## Cross-Stack Relationships

The fixtures include these cross-stack patterns for testing:

### API Call Relationships
1. **GET /api/users** → `UserController@index`
   - Vue: `UserList.vue` fetchUsers()
   - Laravel: UserController::index()
   - Schema: User[] response

2. **GET /api/users/{id}** → `UserController@show`
   - Vue: `UserProfile.vue` fetchUser(id)
   - Laravel: UserController::show(int $id)
   - Schema: User response

3. **POST /api/users** → `UserController@store`
   - Vue: `UserList.vue` createUserApi()
   - Laravel: UserController::store(CreateUserRequest)
   - Schema: CreateUserRequest → User response

4. **PUT /api/users/{id}** → `UserController@update`
   - Vue: `UserProfile.vue` updateUserApi()
   - Laravel: UserController::update(UpdateUserRequest, int $id)
   - Schema: UpdateUserRequest → User response

5. **DELETE /api/users/{id}** → `UserController@destroy`
   - Vue: `UserProfile.vue` deleteUserApi()
   - Laravel: UserController::destroy(int $id)
   - Schema: void response

### Data Contract Relationships
1. **User Interface ↔ User Model**
   - Frontend: `User.ts` interface
   - Backend: `User.php` model
   - Fields: id, name, email, created_at, updated_at

2. **CreateUserRequest Interface ↔ CreateUserRequest Form Request**
   - Frontend: `CreateUserRequest.ts` interface
   - Backend: `CreateUserRequest.php` validation
   - Fields: name (required|string), email (required|email|unique)

3. **UpdateUserRequest Interface ↔ UpdateUserRequest Form Request**
   - Frontend: `UpdateUserRequest.ts` interface
   - Backend: `UpdateUserRequest.php` validation
   - Fields: name (required|string), email (required|email|unique)

## Testing Scenarios

### Expected Cross-Stack Detection Results

#### High Confidence Matches (>0.9)
- Exact URL matches with same HTTP method
- Perfect schema alignment between TypeScript and PHP
- Direct API call patterns with consistent naming

#### Medium Confidence Matches (0.7-0.9)
- Parameterized URLs with pattern matching
- Schema compatibility with minor type differences
- Indirect API calls through composables/services

#### Edge Cases
- Dynamic URL construction with template literals
- Optional fields in schemas
- Conditional API calls
- Error handling patterns

### Performance Benchmarks
- **Analysis Time**: Should complete full project analysis in <5 seconds
- **Memory Usage**: Should use <50MB additional memory
- **Relationship Count**: Should detect 5 API calls and 3 data contracts
- **Accuracy Rate**: Should achieve >85% confidence on main relationships

## Usage

These fixtures are used by:
1. Integration tests (`vue-laravel-analysis.test.ts`)
2. Performance benchmarks
3. Cross-stack accuracy validation
4. Regression testing for Phase 5 features

## Maintenance

When updating cross-stack detection algorithms:
1. Verify all expected relationships are still detected
2. Check confidence scores remain within expected ranges
3. Add new test cases for additional patterns
4. Update performance benchmarks if needed