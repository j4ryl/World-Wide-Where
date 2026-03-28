import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TimelineNode } from "@planit/shared-schema";
import { GripVertical, Route, Sunrise } from "lucide-react";

type TimelineBoardProps = {
  nodes: TimelineNode[];
  onReorder: (nodes: TimelineNode[]) => void;
};

function TimelineItem({ node }: { node: TimelineNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: node.id,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-1 flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-2xl bg-slate-100 text-slate-500 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Day {node.day}</p>
              <h4 className="mt-1 text-lg font-semibold text-slate-950">{node.title}</h4>
            </div>
            <div className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white">
              {node.startTime} - {node.endTime}
            </div>
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-600">{node.note}</p>
          <div className="mt-3 grid gap-2 rounded-[20px] bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 text-slate-400" />
              <span>{node.logistics}</span>
            </div>
            <div className="flex items-center gap-2">
              <Sunrise className="h-4 w-4 text-slate-400" />
              <span>{node.travelMinutesFromPrevious} minutes from the previous stop</span>
            </div>
            {node.priceSummary ? (
              <p>
                Tourist price: <span className="font-semibold text-slate-900">{node.priceSummary.touristPrice}</span>
                {" • "}
                Local angle: <span className="font-semibold text-slate-900">{node.priceSummary.localPrice}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function TimelineBoard({ nodes, onReorder }: TimelineBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Itinerary</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Drag the plan until the route feels natural.</h3>
        </div>
        <div className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white">
          {nodes.length} stops
        </div>
      </div>

      {nodes.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) {
              return;
            }

            const oldIndex = nodes.findIndex((node) => node.id === active.id);
            const newIndex = nodes.findIndex((node) => node.id === over.id);
            onReorder(arrayMove(nodes, oldIndex, newIndex));
          }}
        >
          <SortableContext items={nodes.map((node) => node.id)} strategy={verticalListSortingStrategy}>
            <div className="mt-5 space-y-3">
              {nodes.map((node) => (
                <TimelineItem key={node.id} node={node} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Once the trip has enough shape, I’ll turn it into a day-by-day plan here.
        </div>
      )}
    </section>
  );
}
