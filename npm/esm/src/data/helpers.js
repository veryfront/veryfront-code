export function redirect(destination, permanent = false) {
    return { redirect: { destination, permanent } };
}
export function notFound() {
    return { notFound: true };
}
