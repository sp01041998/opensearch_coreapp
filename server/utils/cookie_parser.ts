function parseCookies(cookieHeader: any): Record<string, any> {
    const cookies: Record<string, any> = {};
    if (!cookieHeader) return cookies;

    cookieHeader.split(';').forEach((cookie) => {
        const [name, ...rest] = cookie.split('=');
        cookies[name.trim()] = decodeURIComponent(rest.join('='));
    });

    return cookies;
}
export { parseCookies };