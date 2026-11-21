/** Storage keys shared by the web app and the worker (no Playwright import). */
export const screenshotKey = (userId: string, applicationId: string) => `${userId}/applications/${applicationId}/screenshot.png`;
