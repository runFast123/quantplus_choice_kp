"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRingingIcon, BellSlashIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import type { ActionState } from "@/lib/errors";
import { removePushSubscription, savePushSubscription, sendTestPushAction } from "./actions";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type Status = "checking" | "unsupported" | "unavailable" | "denied" | "off" | "on";

// VAPID public key (base64url) → bytes for pushManager.subscribe.
function keyBytes(base64url: string) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Turn browser notifications on or off for this browser, and send yourself a test. */
export function PushControls() {
  const [status, setStatus] = useState<Status>("checking");
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setStatus("unsupported");
      if (!PUBLIC_KEY) return setStatus("unavailable");
      if (Notification.permission === "denied") return setStatus("denied");
      setStatus((await currentSubscription()) ? "on" : "off");
    };
    void check();
  }, []);

  const turnOn = () =>
    start(async () => {
      setState({});
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) });
        const result = (await savePushSubscription(subscription.toJSON(), navigator.userAgent)) ?? {};
        if (result.error) await subscription.unsubscribe();
        setState(result);
        setStatus(result.error ? "off" : "on");
      } catch {
        setState({ error: "This browser couldn't turn on notifications. Check that notifications are allowed for this site." });
      }
    });

  const turnOff = () =>
    start(async () => {
      setState({});
      const subscription = await currentSubscription();
      const endpoint = subscription?.endpoint;
      await subscription?.unsubscribe();
      setState(endpoint ? await removePushSubscription(endpoint) : { ok: true, message: "Notifications are off in this browser." });
      setStatus("off");
    });

  const test = () =>
    start(async () => {
      setState({});
      setState(await sendTestPushAction());
    });

  return (
    <div className="flex max-w-xl flex-col gap-4" data-testid="push-controls" data-status={status}>
      <p className="text-[13px] leading-6 text-muted-foreground">
        Get price alerts, exit signals on stocks you hold, research stance changes and plan reminders as browser notifications.
        They arrive after each market close, with the same text as the bell in the app.
      </p>
      {status === "unsupported" ? (
        <p className="text-[13px]">This browser can&apos;t show web notifications. On iPhone, add QuantsPulse to your Home Screen first (Share → Add to Home Screen), then open it from there.</p>
      ) : null}
      {status === "unavailable" ? <p className="text-[13px]">Browser notifications aren&apos;t set up on this server yet.</p> : null}
      {status === "denied" ? (
        <p className="text-[13px]">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload this page.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === "off" ? (
          <Button type="button" onClick={turnOn} disabled={pending}>
            <BellRingingIcon size={16} aria-hidden /> {pending ? "Turning on…" : "Turn on in this browser"}
          </Button>
        ) : null}
        {status === "on" ? (
          <>
            <Button type="button" variant="secondary" onClick={test} disabled={pending}>
              <PaperPlaneTiltIcon size={16} aria-hidden /> Send a test
            </Button>
            <Button type="button" variant="ghost" onClick={turnOff} disabled={pending}>
              <BellSlashIcon size={16} aria-hidden /> Turn off in this browser
            </Button>
          </>
        ) : null}
      </div>
      <FormMessage state={state} />
    </div>
  );
}
