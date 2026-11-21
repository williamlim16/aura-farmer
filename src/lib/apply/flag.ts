/**
 * "Apply with AI" drives a real browser against third-party application forms,
 * so it is off unless NEXT_PUBLIC_APPLY_WITH_AI=1 is set for the deployment.
 * (Public flag, not a secret: it only decides whether the feature is shown.
 * Every route and page also re-checks it and the signed-in user.)
 */
export const applyWithAiEnabled = () => process.env.NEXT_PUBLIC_APPLY_WITH_AI === "1";
