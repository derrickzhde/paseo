import React from "react";

export type ParamListBase = Record<string, object | undefined>;

export interface NavigationContainerRefWithCurrent<T extends ParamListBase> {
  current: NavigationContainerRef<T> | null;
}

export interface NavigationContainerRef<_T extends ParamListBase = ParamListBase> {
  dispatch(action: NavigationAction): void;
  getRootState(): unknown;
  getCurrentRoute(): unknown;
}

export interface NavigationAction {
  type: string;
  payload?: unknown;
  source?: string;
  target?: string;
}

const focusContext = React.createContext(true);

export const NavigationContext = React.createContext(null);
export const NavigationRouteContext = React.createContext(null);

export const useIsFocused = () => React.useContext(focusContext);
export const useFocusEffect = (_callback: () => void) => {};
