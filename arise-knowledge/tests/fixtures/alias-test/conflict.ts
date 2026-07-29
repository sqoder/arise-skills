// Consumer that imports BOTH classes with foo() — disambiguation test.
import { AuthService } from './auth';
import { OtherService } from './other';

export function useBoth(): void {
  const a = new AuthService();
  a.foo();              // must resolve to AuthService.foo, NOT OtherService.foo

  const b = new OtherService();
  b.foo();              // must resolve to OtherService.foo, NOT AuthService.foo
  b.bar();              // must resolve to OtherService.bar
}
