/**
 * AI Request Handler — orchestrates the full "ask AI" flow.
 *
 * Flow: ensureReady → clearResponses → pasteText → clickSend → waitForResponse → return Markdown
 *
 * Design doc: docs/web/AI-Workflow-Protocol-设计.md §四
 */

import type { AIServiceId } from '../../shared/types/ai-service-types';
import { backgroundAI } from './background-ai-webview';
import { SSECaptureManager } from './sse-capture-manager';
import { pasteTextToAI, clickSendButton } from './content-sender';

/** Singleton SSE capture manager — created on first use */
let captureManager: SSECaptureManager | null = null;

/**
 * Send a prompt to an AI service and wait for the complete response.
 *
 * @param serviceId - Which AI service to use
 * @param prompt - The text to send
 * @param timeoutMs - Maximum wait time for response (default: 60s)
 * @returns The AI response as Markdown, or null if failed/timed out
 */
export async function askAI(
  serviceId: AIServiceId,
  prompt: string,
  timeoutMs = 60_000,
): Promise<{ success: boolean; markdown?: string; error?: string }> {
  try {
    // 1. Ensure background webview is ready and on the right service
    const webContents = await backgroundAI.ensureReady(serviceId);

    // 2. Ensure SSE capture is running
    if (!captureManager || captureManager['webContents'] !== webContents) {
      captureManager?.stop();
      captureManager = new SSECaptureManager(webContents);
      captureManager.start();
      // Give the hook a moment to inject after page load
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 3. Clear previous responses
    await captureManager.clearResponses();

    // 4. Paste prompt into input box
    const pasted = await pasteTextToAI(webContents, serviceId, prompt);
    if (!pasted) {
      return { success: false, error: 'Failed to paste text into AI input box' };
    }

    // 5. Small delay to let the UI update (some services need it)
    await new Promise(resolve => setTimeout(resolve, 300));

    // 6. Click send button
    await clickSendButton(webContents, serviceId);

    // 7. Wait for AI response
    const markdown = await captureManager.waitForResponse(timeoutMs);
    if (!markdown) {
      return { success: false, error: 'AI response timed out' };
    }

    return { success: true, markdown };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Get the SSE capture status (for debugging).
 */
export async function getSSEStatus(): Promise<{
  count: number;
  latestStreaming: boolean;
  hooked: boolean;
}> {
  if (!captureManager) {
    return { count: 0, latestStreaming: false, hooked: false };
  }
  return captureManager.getStatus();
}
