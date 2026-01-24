"use client";

import { useEffect, useState } from "react";

interface Service {
  id: string;
  name: string;
  connected: boolean;
  authUrl: string;
}

interface ServiceConnectionsProps {
  services: Array<{
    id: string;
    name: string;
    authUrl: string;
  }>;
  className?: string;
}

function useIntegrationStatus(): { status: Record<string, boolean>; loading: boolean } {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkStatus(): Promise<void> {
      try {
        const res = await fetch("/api/integrations/status");
        if (!res.ok) return;

        const data = await res.json();
        const integrations = data?.integrations ?? [];

        const statusMap: Record<string, boolean> = {};
        for (const integration of integrations) {
          statusMap[integration.id] = integration.connected;
        }

        setStatus(statusMap);
      } catch (err) {
        console.error("Failed to check service status:", err);
      } finally {
        setLoading(false);
      }
    }

    checkStatus();
  }, []);

  return { status, loading };
}

export function ServiceConnections({
  services,
  className = "",
}: ServiceConnectionsProps): React.ReactElement {
  const { status, loading } = useIntegrationStatus();

  const servicesWithStatus: Service[] = services.map((s) => ({
    ...s,
    connected: status[s.id] ?? false,
  }));

  const connectedCount = servicesWithStatus.filter((s) => s.connected).length;

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="animate-pulse h-6 w-32 bg-neutral-200 dark:bg-neutral-700 rounded" />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {servicesWithStatus.map((service) => (
        <ServiceBadge key={service.id} service={service} />
      ))}
      {connectedCount < services.length && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-1">
          {connectedCount}/{services.length} connected
        </span>
      )}
    </div>
  );
}

function ServiceBadge({ service }: { service: Service }): React.ReactElement {
  if (service.connected) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
        title={`${service.name} connected`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        {service.name}
      </span>
    );
  }

  function handleConnect(): void {
    globalThis.location.href = service.authUrl;
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 transition-colors"
      title={`Connect ${service.name}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
      {service.name}
    </button>
  );
}

export function ServiceConnectionsCard({
  services,
  className = "",
}: ServiceConnectionsProps): React.ReactElement | null {
  const { status, loading } = useIntegrationStatus();

  const servicesWithStatus: Service[] = services.map((s) => ({
    ...s,
    connected: status[s.id] ?? false,
  }));

  const disconnectedServices = servicesWithStatus.filter((s) => !s.connected);

  if (loading || disconnectedServices.length === 0) return null;

  return (
    <div
      className={`rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-4 ${className}`}
    >
      <h3 className="font-medium text-amber-900 dark:text-amber-200 mb-2">
        Connect your services
      </h3>
      <p className="text-sm text-amber-700 dark:text-amber-300/80 mb-3">
        Connect the following services to unlock all features:
      </p>
      <div className="flex flex-wrap gap-2">
        {disconnectedServices.map((service) => (
          <a
            key={service.id}
            href={service.authUrl}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60 transition-colors"
          >
            Connect {service.name}
          </a>
        ))}
      </div>
    </div>
  );
}
