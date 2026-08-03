/** Provider-neutral routing-invalidation primitives shared with extensions. */

export {
  parseProxyRoutingInvalidationEvent,
  type ProxyRoutingInvalidationEvent,
  type ProxyRoutingInvalidationPublisher,
  type ProxyRoutingInvalidationPublishResult,
} from "#veryfront/proxy/routing-invalidation.ts";
export {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
} from "#veryfront/utils/project-identity.ts";
