export function apiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
}

export function apiUrl(pathOrUrl: string) {
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const baseUrl = apiBaseUrl();

  if (!baseUrl) {
    return pathOrUrl;
  }

  return `${baseUrl.replace(/\/$/, "")}/${pathOrUrl.replace(/^\//, "")}`;
}
