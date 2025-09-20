<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * Create User Request
 *
 * Handles validation for creating new users.
 * Validation rules match the TypeScript CreateUserRequest interface
 * and provide schema compatibility for cross-stack analysis.
 */
class CreateUserRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     *
     * @return bool
     */
    public function authorize(): bool
    {
        // For this test fixture, we allow all requests
        // In a real application, this would check user permissions
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * These rules match the TypeScript CreateUserRequest interface:
     * - name: string (required, max 255 characters)
     * - email: string (required, unique, valid email format)
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => [
                'required',
                'string',
                'max:255',
                'min:1',
                'regex:/^[\pL\s\-\.\']+$/u', // Letters, spaces, hyphens, dots, apostrophes
            ],
            'email' => [
                'required',
                'string',
                'email:rfc,dns',
                'max:255',
                'unique:users,email',
                'lowercase',
            ],
        ];
    }

    /**
     * Get custom validation messages.
     *
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.required' => 'The name field is required.',
            'name.string' => 'The name must be a valid string.',
            'name.max' => 'The name must not exceed 255 characters.',
            'name.min' => 'The name must be at least 1 character.',
            'name.regex' => 'The name may only contain letters, spaces, hyphens, dots, and apostrophes.',

            'email.required' => 'The email field is required.',
            'email.string' => 'The email must be a valid string.',
            'email.email' => 'The email must be a valid email address.',
            'email.max' => 'The email must not exceed 255 characters.',
            'email.unique' => 'The email has already been taken.',
            'email.lowercase' => 'The email must be in lowercase.',
        ];
    }

    /**
     * Get custom attributes for validator errors.
     *
     * @return array<string, string>
     */
    public function attributes(): array
    {
        return [
            'name' => 'user name',
            'email' => 'email address',
        ];
    }

    /**
     * Prepare the data for validation.
     *
     * @return void
     */
    protected function prepareForValidation(): void
    {
        // Normalize email to lowercase and trim whitespace
        if ($this->has('email')) {
            $this->merge([
                'email' => strtolower(trim($this->input('email')))
            ]);
        }

        // Trim whitespace from name
        if ($this->has('name')) {
            $this->merge([
                'name' => trim($this->input('name'))
            ]);
        }
    }

    /**
     * Get the validated data from the request.
     *
     * This ensures only validated fields are returned,
     * matching the TypeScript CreateUserRequest interface.
     *
     * @param string|null $key
     * @param mixed $default
     * @return mixed
     */
    public function validated($key = null, $default = null)
    {
        $validated = parent::validated($key, $default);

        // If getting all validated data, ensure structure matches TypeScript interface
        if ($key === null) {
            return [
                'name' => $validated['name'],
                'email' => $validated['email'],
            ];
        }

        return $validated;
    }

    /**
     * Handle a failed validation attempt.
     *
     * @param Validator $validator
     * @return void
     *
     * @throws HttpResponseException
     */
    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(
            response()->json([
                'error' => 'Validation failed',
                'message' => 'The given data was invalid.',
                'errors' => $validator->errors()->toArray(),
            ], 422)
        );
    }

    /**
     * Configure the validator instance.
     *
     * @param Validator $validator
     * @return void
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            // Additional custom validation logic can go here

            // Example: Check for prohibited email domains
            if ($this->has('email')) {
                $email = $this->input('email');
                $prohibitedDomains = ['example.com', 'test.com', 'invalid.com'];

                foreach ($prohibitedDomains as $domain) {
                    if (str_ends_with($email, "@{$domain}")) {
                        $validator->errors()->add(
                            'email',
                            "The email domain '{$domain}' is not allowed."
                        );
                        break;
                    }
                }
            }

            // Example: Check for reserved names
            if ($this->has('name')) {
                $name = strtolower($this->input('name'));
                $reservedNames = ['admin', 'administrator', 'root', 'system', 'api'];

                if (in_array($name, $reservedNames)) {
                    $validator->errors()->add(
                        'name',
                        'This name is reserved and cannot be used.'
                    );
                }
            }
        });
    }

    /**
     * Get validation rules for testing/documentation purposes.
     *
     * This method provides a way for cross-stack analysis tools
     * to understand the validation schema.
     *
     * @return array
     */
    public static function getValidationSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'name' => [
                    'type' => 'string',
                    'minLength' => 1,
                    'maxLength' => 255,
                    'pattern' => '^[\pL\s\-\.\']+$',
                    'description' => 'User\'s full name'
                ],
                'email' => [
                    'type' => 'string',
                    'format' => 'email',
                    'maxLength' => 255,
                    'description' => 'User\'s email address (must be unique)'
                ]
            ],
            'required' => ['name', 'email'],
            'additionalProperties' => false
        ];
    }
}