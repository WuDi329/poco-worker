// utils.ts
/**
 * 等待指定的毫秒数
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}