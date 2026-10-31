import DbImage from "@/components/common/DbImage";

/**
 * The circle-over-label unit that both the homepage's Browse By Category
 * section and a profile's category row render.
 *
 * Shared so the two cannot drift — they are the same visual element, differing
 * only in what wraps them: a category link on the homepage, a drill-down
 * control on a profile. Neither wrapper adds a background box behind the tile
 * and neither marks one as selected — the row is navigation, and on a profile
 * it steps aside entirely once a choice has been made rather than highlighting
 * the choice.
 *
 * **No icon means an empty circle, with nothing drawn in its place.** There is
 * no glyph fallback: a stand-in chosen by us would claim to be the category's
 * image, and a row of them reads as a different design rather than as missing
 * artwork. This is the same rule the image surfaces already follow (the design
 * follows the value, never the load result), so a tile whose icon value is
 * absent and one whose stored object is missing now look the same — which is
 * the point.
 */
export default function CategoryTileBody({
  name,
  icon,
}: {
  name: string;
  icon: string | null;
}) {
  return (
    <>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 transition group-hover:bg-blue-200">
        {icon && (
          <DbImage
            src={icon}
            alt={name}
            width={120}
            height={120}
            className="object-contain"
          />
        )}
      </div>
      <span className="mt-4 type-body-sm text-foreground">{name}</span>
    </>
  );
}
