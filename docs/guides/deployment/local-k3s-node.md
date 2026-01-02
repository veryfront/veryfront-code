---
title: Add Local K3s Node
description: Add a local Kubernetes node to the cluster using OrbStack, Tailscale, and k3s
keywords:
  - k3s
  - kubernetes
  - orbstack
  - tailscale
  - local development
  - cluster node
related:
  - /docs/guides/deployment/deno.md
  - /docs/guides/deployment/node.md
---

# Add Local K3s Node

Add your Mac as a Kubernetes cluster node using OrbStack, Tailscale for networking, and k3s join token from 1Password.

## Prerequisites

- **OrbStack** - [Download](https://orbstack.dev/) and install
- **Tailscale** - Account and CLI installed
- **1Password CLI** - `op` command configured
- **Cluster access** - Existing k3s cluster on Tailscale network

## Step 1: Create Linux VM in OrbStack

```bash
# Create an Ubuntu VM
orb create ubuntu k3s-node

# Enter the VM
orb shell k3s-node
```

## Step 2: Install Tailscale in VM

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate (opens browser)
sudo tailscale up

# Verify connection
tailscale status
```

## Step 3: Get K3s Token from 1Password

From your Mac terminal (not the VM):

```bash
# Get the k3s join token
op read "op://Private/k3s-cluster/token"

# Or export as environment variable
export K3S_TOKEN=$(op read "op://Private/k3s-cluster/token")
```

> **Note**: Adjust the 1Password path (`op://Private/k3s-cluster/token`) to match your vault/item structure.

## Step 4: Get Server URL

The k3s server URL should be the Tailscale IP of your control plane node:

```bash
# Find the control plane's Tailscale IP
tailscale status | grep k3s-server

# Example: 100.x.x.x
```

## Step 5: Join the Cluster

Back in the OrbStack VM:

```bash
# Install k3s as agent (worker node)
curl -sfL https://get.k3s.io | K3S_URL=https://<SERVER_TAILSCALE_IP>:6443 K3S_TOKEN=<TOKEN> sh -

# Or with environment variables
curl -sfL https://get.k3s.io | K3S_URL=https://100.x.x.x:6443 K3S_TOKEN=$K3S_TOKEN sh -
```

## Step 6: Verify Node Joined

From a machine with kubectl access:

```bash
# Check node status
kubectl get nodes

# Should show your new node
# NAME        STATUS   ROLES    AGE   VERSION
# k3s-node    Ready    <none>   1m    v1.29.x+k3s1
```

## One-Liner Script

Combine all steps into a single script:

```bash
#!/bin/bash
set -e

SERVER_IP="100.x.x.x"  # Your k3s server Tailscale IP
TOKEN=$(op read "op://Private/k3s-cluster/token")

# Create and setup VM
orb create ubuntu k3s-node

orb run k3s-node bash -c "
  # Install Tailscale
  curl -fsSL https://tailscale.com/install.sh | sh
  sudo tailscale up --authkey=\$TAILSCALE_AUTHKEY

  # Join k3s cluster
  curl -sfL https://get.k3s.io | K3S_URL=https://$SERVER_IP:6443 K3S_TOKEN=$TOKEN sh -
"

echo "Node joined! Check with: kubectl get nodes"
```

## Troubleshooting

### Node not joining

```bash
# Check k3s agent logs
orb run k3s-node journalctl -u k3s-agent -f
```

### Tailscale connectivity

```bash
# Verify Tailscale can reach server
orb run k3s-node tailscale ping <SERVER_TAILSCALE_IP>
```

### Token issues

```bash
# Verify token is correct (on server node)
sudo cat /var/lib/rancher/k3s/server/node-token
```

### Firewall/ports

Ensure port 6443 is accessible on the k3s server. Tailscale usually handles this, but verify:

```bash
# Test port connectivity
orb run k3s-node nc -zv <SERVER_TAILSCALE_IP> 6443
```

## Cleanup

To remove the local node:

```bash
# Drain and delete from cluster
kubectl drain k3s-node --ignore-daemonsets --delete-emptydir-data
kubectl delete node k3s-node

# Delete OrbStack VM
orb delete k3s-node
```
