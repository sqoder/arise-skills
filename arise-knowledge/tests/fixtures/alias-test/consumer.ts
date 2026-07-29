// Consumer module: exercises every alias form we want to resolve.
import { AuthService, authInit } from './auth';
import * as authNs from './auth';
import { AuthService as RenamedService } from './auth';

export function useService(): void {
  // Case 1: instance method call via local variable
  const service = new AuthService();
  service.foo();                      // should resolve to AuthService.foo

  // Case 2: direct standalone function call (named import)
  authInit();                          // should resolve to authInit

  // Case 3: namespace property access
  authNs.authInit();                   // should resolve to authInit

  // Case 4: renamed class, instantiate then call method
  const rs = new RenamedService();
  rs.foo();                            // should resolve to AuthService.foo

  // Case 5: static method call on imported class
  AuthService.create();               // should resolve to AuthService.create
}
