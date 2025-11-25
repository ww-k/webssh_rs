export default function PromiseWithResolvers<value = unknown>() {
    let resolve: (value: value) => void, reject: (reason?: unknown) => void;
    const promise = new Promise<value>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    // @ts-expect-error
    return { promise, resolve, reject };
}
