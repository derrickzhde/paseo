import React from "react";

export type Href = string;

const noop = () => {};
const noopRouter = {
  back: noop,
  canGoBack: () => false,
  dismissTo: noop,
  navigate: noop,
  push: noop,
  replace: noop,
  setParams: noop,
};

const RouterPassthrough = ({ children }: { children?: React.ReactNode }) => children ?? null;

export const Redirect = () => null;

export const Stack = Object.assign(RouterPassthrough, {
  Screen: () => null,
  Protected: RouterPassthrough,
});

export const router = noopRouter;

export const useGlobalSearchParams = () => ({});
export const useLocalSearchParams = () => ({});
export const usePathname = () => "/";
export const useRootNavigationState = () => ({ key: "root" });
export const useRouter = () => noopRouter;
export const useNavigation = () => ({});
export const useNavigationContainerRef = () => ({ current: null });

export const ExpoRoot = ({ children }: { children?: React.ReactNode }) => children ?? null;

export default {};
