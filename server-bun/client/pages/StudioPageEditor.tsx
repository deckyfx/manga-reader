import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw, Send, TriangleAlert } from "lucide-react";
import {
  getPage,
  PAGE_IMAGES,
  pageFileUrl,
  publishPage,
  renderPage,
  updateTranslation,
  type PageImage,
  type StudioBlock,
  type StudioPageDetail,
} from "../api";
import { StatusBadge } from "../components/StatusBadge";

/** Studio editor for one page: compare stage images, edit translations, re-render and publish. */
export function StudioPageEditor() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const pageQ = useQuery({ queryKey: ["studio-page", id], queryFn: () => getPage(id), enabled: id !== "" });
  const setDetail = (detail: StudioPageDetail) => qc.setQueryData(["studio-page", id], detail);

  const [published, setPublished] = useState<{ revision: number; notified: number } | null>(null);
  const renderM = useMutation({ mutationFn: () => renderPage(id), onSuccess: setDetail });
  const publishM = useMutation({ mutationFn: () => publishPage(id), onSuccess: setPublished });

  const detail = pageQ.data;
  if (pageQ.isLoading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (!detail) return <p className="m-4 text-sm text-red-400">{pageQ.error?.message ?? "Page not found"}</p>;

  const { page, stages, blocks } = detail;
  const renderStage = stages.find((s) => s.stage === "render");
  const busy = page.status === "queued" || page.status === "running";
  const textBlocks = blocks.filter((b) => b.kind === "text");
  const sfxCount = blocks.length - textBlocks.length;
  const version = `${page.updated_at}-${renderStage?.updated_at ?? ""}`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
        <Link to="/studio" className="text-gray-400 hover:text-white" title="All pages">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-base font-semibold truncate">Page {page.id.slice(-8)}</h1>
        <StatusBadge status={page.status} />
        <span className="text-xs text-gray-500">rev {page.revision}</span>
        <div className="flex flex-wrap gap-1.5">
          {stages.map((s) => (
            <span key={s.stage} title={s.error ?? s.updated_at}>
              <StatusBadge status={s.status} label={s.stage} />
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {(renderM.error ?? publishM.error) && (
            <span className="text-xs text-red-400">{(renderM.error ?? publishM.error)?.message}</span>
          )}
          {published && !publishM.isPending && (
            <span className="text-xs text-emerald-400">
              Published rev {published.revision} · {published.notified} open tab{published.notified === 1 ? "" : "s"} updated
            </span>
          )}
          <button
            onClick={() => renderM.mutate()}
            disabled={busy || renderM.isPending}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
              renderStage?.status === "stale" ? "bg-amber-600 hover:bg-amber-500" : "bg-gray-800 hover:bg-gray-700"
            }`}
          >
            {renderM.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Re-render
          </button>
          <button
            onClick={() => publishM.mutate()}
            disabled={busy || publishM.isPending || !page.has_result || renderStage?.status === "stale"}
            title={renderStage?.status === "stale" ? "Re-render before publishing" : "Replace the image in open extension tabs"}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {publishM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Publish
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <StageCompare pageId={page.id} version={version} />

        <aside className="lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-gray-800 overflow-y-auto p-3 space-y-3">
          <div className="text-xs text-gray-500">
            {textBlocks.length} text block{textBlocks.length === 1 ? "" : "s"} · {sfxCount} sound effect{sfxCount === 1 ? "" : "s"}
          </div>
          {textBlocks.map((block) => (
            <BlockEditor key={block.id} pageId={page.id} block={block} disabled={busy} onSaved={setDetail} />
          ))}
        </aside>
      </div>
    </div>
  );
}

/** Two stage images on top of each other with a slider revealing the left one. */
function StageCompare({ pageId, version }: { pageId: string; version: string }) {
  const [left, setLeft] = useState<PageImage>("original.png");
  const [right, setRight] = useState<PageImage>("result.png");
  const [split, setSplit] = useState(50);

  const select = (value: PageImage, onChange: (file: PageImage) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(PAGE_IMAGES.find((img) => img.file === e.target.value)?.file ?? value)}
      className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs"
    >
      {PAGE_IMAGES.map((img) => (
        <option key={img.file} value={img.file}>{img.label}</option>
      ))}
    </select>
  );

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800">
        {select(left, setLeft)}
        <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="flex-1" />
        {select(right, setRight)}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="relative mx-auto w-fit">
          <img src={pageFileUrl(pageId, right, version)} alt="" className="block max-h-[calc(100vh-10rem)] w-auto" />
          <img
            src={pageFileUrl(pageId, left, version)}
            alt=""
            className="absolute inset-0 h-full w-full"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <div className="absolute inset-y-0 w-0.5 bg-indigo-400 pointer-events-none" style={{ left: `${split}%` }} />
        </div>
      </div>
    </section>
  );
}

/** One text block: source text and an editable translation, saved when the field loses focus. */
function BlockEditor({ pageId, block, disabled, onSaved }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onSaved: (detail: StudioPageDetail) => void;
}) {
  const saved = block.translated_text ?? "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const saveM = useMutation({ mutationFn: (value: string) => updateTranslation(pageId, block.id, value), onSuccess: onSaved });
  const dirty = useMemo(() => text !== saved, [text, saved]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-sky-400">#{block.id}</span>
        {block.render && !block.render.fits && (
          <span className="flex items-center gap-1 text-amber-400" title="The text did not fit its area">
            <TriangleAlert size={12} /> overflow
          </span>
        )}
        {block.render && <span className="text-gray-500">{block.render.font_size}px</span>}
        {saveM.isPending && <Loader2 size={12} className="animate-spin text-gray-500" />}
        {dirty && !saveM.isPending && <span className="text-amber-400">unsaved</span>}
      </div>
      {block.source_text && <p className="text-sm text-gray-400 whitespace-pre-wrap">{block.source_text}</p>}
      <textarea
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => dirty && saveM.mutate(text)}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 40)))}
        className="w-full resize-y bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
      />
      {saveM.error && <p className="text-xs text-red-400">{saveM.error.message}</p>}
    </div>
  );
}
