/**
 * App Components Templates - UI Utility Components
 *
 * @module cli/templates/app/components/ui-templates
 */

import type { TemplateFile } from "./types.ts";

/**
 * UI utility component templates (Toaster)
 */
export const uiComponentTemplates: TemplateFile[] = [
  {
    path: "components/Toaster.tsx",
    content: `'use client';

import React, { useState, useEffect } from "react";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

let toastListener: ((toast: Toast) => void) | null = null;

export function showToast(message: string, type: Toast["type"] = "info") {
  const toast: Toast = {
    id: Math.random().toString(36),
    message,
    type,
  };
  toastListener?.(toast);
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    toastListener = (toast) => {
      setToasts(prev => [...prev, toast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, 3000);
    };

    return () => {
      toastListener = null;
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={\`px-4 py-3 rounded-lg shadow-lg text-white transition-all \${
            toast.type === "success" ? "bg-green-500" :
            toast.type === "error" ? "bg-red-500" : "bg-blue-500"
          }\`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}`,
  },
];
