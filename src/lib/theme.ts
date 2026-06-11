import { useEffect, useState } from "react";

export function useTheme() {
  // Chave v2: o redesign claro (estilo Intercom) vira o padrão para todos —
  // a preferência antiga "dark" não é migrada de propósito.
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("clouddesk-theme-v2") as "light" | "dark") || "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("clouddesk-theme-v2", theme);
  }, [theme]);

  const toggleTheme = () => setThemeState(prev => prev === "dark" ? "light" : "dark");

  return { theme, setTheme: setThemeState, toggleTheme };
}
