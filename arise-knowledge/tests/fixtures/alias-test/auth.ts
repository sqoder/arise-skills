// Source module: defines a class with methods + a standalone function
export class AuthService {
  foo(): void {
    console.log('AuthService.foo called');
  }

  static create(): AuthService {
    return new AuthService();
  }
}

export function authInit(): void {
  console.log('authInit called');
}

export const VERSION = '1.0.0';
