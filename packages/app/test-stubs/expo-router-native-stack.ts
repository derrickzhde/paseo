export interface NativeStackNavigationProp<T extends Record<string, object | undefined>> {
  navigate(name: string, params?: T[string]): void;
  push(name: string, params?: T[string]): void;
  replace(name: string, params?: T[string]): void;
  goBack(): void;
}
