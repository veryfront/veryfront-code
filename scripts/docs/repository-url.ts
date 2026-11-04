/** Public package identity must never expose local paths or private mirror credentials. */
export function publicRepositoryUrl(remote: string): string {
  const source = remote.replace(/^git\+/, "");
  const scp = /^(?:[^/@:]+@)?github\.com:([^?#]+)$/.exec(source);
  let pathname: string;
  if (scp?.[1]) pathname = scp[1];
  else {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error(
        "Public documentation requires a GitHub repository origin",
      );
    }
    if (
      url.hostname !== "github.com" ||
      !["https:", "http:", "ssh:", "git:"].includes(url.protocol)
    ) {
      throw new Error(
        "Public documentation requires a GitHub repository origin",
      );
    }
    pathname = url.pathname.replace(/^\//, "");
  }
  const repository = pathname.replace(/\.git$/, "");
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
    throw new Error("Invalid public repository identity");
  }
  return `https://github.com/${repository}`;
}
