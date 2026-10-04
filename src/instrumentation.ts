export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { readConfiguration } = await import("./server/config");
    readConfiguration(process.env);
  }
}
