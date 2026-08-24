// Regression cover for the Gallery delete flow.
//
// Delete used to be gated behind window.confirm(), which a WebView with no
// JS-dialog handler resolves to false without ever showing anything — so the
// delete silently did nothing on native. It now uses an in-app AlertDialog.
// These tests pin the behaviour that broke: a confirmation is actually shown,
// cancelling does not delete, and confirming deletes the row the user picked
// (the stale-closure trap, since the confirm handler reads pending state).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  return {
    deleteEq,
    storageRemove: vi.fn().mockResolvedValue({ error: null }),
    vaultRows: [
      { id: "row-1", file_name: "first.png",  file_type: "image/png", file_url: "https://cdn.test/first.png",  description: "", tags: [] as string[], created_at: "2026-08-01T00:00:00Z" },
      { id: "row-2", file_name: "second.png", file_type: "image/png", file_url: "https://cdn.test/second.png", description: "", tags: [] as string[], created_at: "2026-08-02T00:00:00Z" },
    ],
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "t", user: { id: "u1" } }, user: { id: "u1" } }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => ({
    select: () => table(name),
    eq: (...args: any[]) => (name === "__delete" ? h.deleteEq(...args) : table(name)),
    not: () => table(name),
    order: () => table(name),
    limit: () => Promise.resolve({
      data: name === "vault_media" ? h.vaultRows : [],
      error: null,
    }),
    delete: () => ({ eq: h.deleteEq }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  });
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }) },
      from: (n: string) => table(n),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      storage: {
        from: () => ({
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
          remove: h.storageRemove,
          upload: () => Promise.resolve({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "https://cdn.test/x.png" } }),
        }),
      },
    },
  };
});

import { GalleryPage } from "@/pages/GalleryPage";

async function openGallery() {
  render(<GalleryPage />);
  expect(await screen.findByText("first.png")).toBeInTheDocument();
}

function deleteButtonFor(title: string) {
  // Each card renders its own Delete affordance; pick the one in the card
  // whose caption matches.
  const caption = screen.getByText(title);
  const card = caption.closest(".group") as HTMLElement;
  return card.querySelector('button[title="Delete"]') as HTMLElement;
}

describe("Gallery delete", () => {
  beforeEach(() => {
    h.deleteEq.mockClear();
    h.storageRemove.mockClear();
  });

  it("asks for confirmation instead of deleting immediately", async () => {
    await openGallery();

    fireEvent.click(deleteButtonFor("second.png"));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    // Nothing is destroyed until the user confirms.
    expect(h.deleteEq).not.toHaveBeenCalled();
  });

  it("does not delete when cancelled", async () => {
    await openGallery();

    fireEvent.click(deleteButtonFor("second.png"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.deleteEq).not.toHaveBeenCalled();
    expect(screen.getByText("second.png")).toBeInTheDocument();
  });

  it("deletes the row the user picked and removes its card", async () => {
    await openGallery();

    fireEvent.click(deleteButtonFor("second.png"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    // The confirm handler reads the pending item out of state — if that closure
    // went stale it would delete the wrong row, or none at all.
    await waitFor(() => expect(h.deleteEq).toHaveBeenCalledWith("id", "row-2"));
    await waitFor(() => expect(screen.queryByText("second.png")).not.toBeInTheDocument());
    expect(screen.getByText("first.png")).toBeInTheDocument();
  });
});
