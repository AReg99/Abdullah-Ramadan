import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * What the record on screen is called.
 *
 * The shell knows which app you are in — it can read that off the path — but it
 * cannot know that `/orders/9f3c…` is order AUR-2026-0064, because only the
 * screen that loaded the record knows. Without this the breadcrumb reads
 * "Orders / 9f3c8a1b…", which is worse than no breadcrumb: it takes up the
 * space where the answer should be and puts a database key there instead.
 *
 * So a record screen says what it is showing, and clears it on the way out.
 */
type Ctx = { crumb: string | null; setCrumb: (c: string | null) => void };
const CrumbCtx = createContext<Ctx>({ crumb: null, setCrumb: () => {} });

export function CrumbProvider({ children }: { children: ReactNode }) {
  const [crumb, setCrumb] = useState<string | null>(null);
  return <CrumbCtx.Provider value={{ crumb, setCrumb }}>{children}</CrumbCtx.Provider>;
}

export const useCrumbValue = () => useContext(CrumbCtx).crumb;

/** Name the record this screen is showing. Pass null while it is still loading. */
export function useCrumb(label: string | null | undefined) {
  const { setCrumb } = useContext(CrumbCtx);
  useEffect(() => {
    setCrumb(label ?? null);
    return () => setCrumb(null);
  }, [label, setCrumb]);
}
