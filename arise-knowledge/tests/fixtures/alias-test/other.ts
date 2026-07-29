// Another module with a class that ALSO has a foo() method.
// If resolution falls back to global suffix match (name LIKE '%.foo'),
// it might wrongly resolve service.foo() to OtherService.foo.
export class OtherService {
  foo(): void {
    console.log('OtherService.foo — should NOT be picked');
  }

  bar(): void {
    console.log('OtherService.bar');
  }
}
