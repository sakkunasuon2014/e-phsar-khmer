import { Text, View } from "react-native";

type BrandWordmarkProps = {
  className?: string;
  /** Blue headers: render on a white chip so theme-blue "Khmer" stays visible. */
  tone?: "default" | "onPrimary";
};

export function BrandWordmark({
  className,
  tone = "default",
}: BrandWordmarkProps) {
  const text = (
    <Text
      className={`font-black tracking-tight ${
        tone === "onPrimary" ? "text-gray-900" : "text-gray-900 dark:text-white"
      } ${className ?? ""}`}
    >
      {"Phsar"}
      <Text className="text-primary">Khmer</Text>
    </Text>
  );

  if (tone === "onPrimary") {
    return <View className="rounded-2xl bg-white px-4 py-1.5">{text}</View>;
  }
  return text;
}
