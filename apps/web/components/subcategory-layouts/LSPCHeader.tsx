"use client";

import { useState } from "react";

// Define Filters interface locally
interface Filters {
  search: string;
  province: string;
  district: string;
  commune: string;
  sort: string;
  price: number;
  minPrice: string;
  maxPrice: string;
  priceRange: string;
  condition: string;
}

interface LSPCHeaderProps {
  title: string;
  onShowFilters?: () => void; // Optional callback for parent to handle modal
}

export default function LSPCHeader({ title, onShowFilters }: LSPCHeaderProps) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [filters, setFilters] = useState<Filters>({
    search: "",
    province: "",
    district: "",
    commune: "",
    sort: "latest",
    price: 0,
    minPrice: "",
    maxPrice: "",
    priceRange: "",
    condition: "",
  });

  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showPriceDropdown, setShowPriceDropdown] = useState(false);
  const [showConditionDropdown, setShowConditionDropdown] = useState(false);

  // Helper functions...
  const getProvinceLabel = () => {
    if (!filters.province) return "All Locations";
    if (filters.province === "phnom-penh") return "Phnom Penh";
    if (filters.province === "siem-reap") return "Siem Reap";
    if (filters.province === "battambang") return "Battambang";
    if (filters.province === "sihanoukville") return "Sihanoukville";
    return filters.province
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const getSortLabel = () => {
    if (filters.sort === "latest") return "Sort";
    if (filters.sort === "oldest") return "Oldest First";
    if (filters.sort === "price-low") return "Price: Low to High";
    if (filters.sort === "price-high") return "Price: High to Low";
    return "Sort";
  };

  const getPriceLabel = () => {
    if (!filters.priceRange) return "Price";
    switch (filters.priceRange) {
      case "under-100":
        return "Under $100";
      case "100-500":
        return "$100-$500";
      case "500-plus":
        return "$500+";
      default:
        return "Price";
    }
  };

  const getConditionLabel = () => {
    if (!filters.condition) return "Condition";
    if (filters.condition === "new") return "New";
    if (filters.condition === "used") return "Used";
    if (filters.condition === "refurbished") return "Refurbished";
    return "Condition";
  };

  const handleMoreFilters = () => {
    if (onShowFilters) {
      onShowFilters(); // Call parent callback if provided
    }
    // Otherwise, you'll need to handle the modal here or use a state management solution
  };

  return (
    <div className="bg-white border-b border-gray-200 px-1 py-1 md:px-2 md:py-1 select-none">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="type-page-title">
          {title} <span>in Cambodia</span>
        </h1>

        {/* Right Icons */}
        <div className="flex gap-2">
          {/* 💰 Price Icon */}
          <button className="p-1 rounded hover:bg-gray-100 flex items-center justify-center">
            <i className="bi bi-percent text-[20px] text-gray-900"></i>
          </button>

          {/* 🚚 Free Delivery Icon */}
          <button className="p-1 rounded hover:bg-gray-100 flex items-center justify-center">
            <i className="bi bi-truck text-[20px] text-gray-900"></i>
          </button>

          {/* 📐 Grid/List Toggle */}
          <button
            onClick={() => setView(view === "grid" ? "list" : "grid")}
            className="p-1 rounded hover:bg-gray-100 flex items-center justify-center"
          >
            {view === "grid" ? (
              <i className="bi bi-grid text-[20px] text-gray-900"></i>
            ) : (
              <i className="bi bi-list-ul text-[20px] text-gray-900"></i>
            )}
          </button>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-wrap gap-2 items-center mb-1">
        {/* Location Filter */}
        <div className="relative">
          <button
            onClick={() => setShowLocationDropdown(!showLocationDropdown)}
            className={`flex items-center gap-1 bg-gray-100 border border-gray-200 rounded px-3 py-1.5 type-nav hover:bg-gray-200
              ${
                filters.province
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "text-gray-700"
              }`}
          >
            <i className="bi bi-geo-alt text-sm"></i>
            <span className="font-medium whitespace-nowrap">
              {getProvinceLabel()}
            </span>
            <i
              className={`bi bi-chevron-down text-xs transition-transform ${showLocationDropdown ? "rotate-180" : ""}`}
            ></i>
          </button>

          {showLocationDropdown && (
            <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-2">
              {[
                { val: "", label: "All Locations" },
                { val: "phnom-penh", label: "Phnom Penh" },
                { val: "siem-reap", label: "Siem Reap" },
                { val: "battambang", label: "Battambang" },
                { val: "sihanoukville", label: "Sihanoukville" },
              ].map((loc) => (
                <button
                  key={loc.val}
                  onClick={() => {
                    setFilters({ ...filters, province: loc.val });
                    setShowLocationDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 type-nav text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between"
                >
                  <span>{loc.label}</span>
                  {filters.province === loc.val && (
                    <i className="bi bi-check text-blue-600"></i>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort Filter */}
        <div className="relative">
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className={`flex items-center gap-1 bg-gray-100 border border-gray-200 rounded px-3 py-1.5 type-nav hover:bg-gray-200
              ${
                filters.sort !== "latest"
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "text-gray-700"
              }`}
          >
            <span className="font-medium whitespace-nowrap">
              {getSortLabel()}
            </span>
            <i
              className={`bi bi-chevron-down text-xs transition-transform ${showSortDropdown ? "rotate-180" : ""}`}
            ></i>
          </button>

          {showSortDropdown && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-2">
              {[
                { val: "latest", label: "Newest First" },
                { val: "oldest", label: "Oldest First" },
                { val: "price-low", label: "Price: Low to High" },
                { val: "price-high", label: "Price: High to Low" },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => {
                    setFilters({ ...filters, sort: opt.val });
                    setShowSortDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 type-nav text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between"
                >
                  <span>{opt.label}</span>
                  {filters.sort === opt.val && (
                    <i className="bi bi-check text-blue-600"></i>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Price Filter */}
        <div className="relative">
          <button
            onClick={() => setShowPriceDropdown(!showPriceDropdown)}
            className={`flex items-center gap-1 bg-gray-100 border border-gray-200 rounded px-3 py-1.5 type-nav hover:bg-gray-200
              ${
                filters.priceRange
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "text-gray-700"
              }`}
          >
            <span className="font-medium whitespace-nowrap">
              {getPriceLabel()}
            </span>
            <i
              className={`bi bi-chevron-down text-xs transition-transform ${showPriceDropdown ? "rotate-180" : ""}`}
            ></i>
          </button>

          {showPriceDropdown && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-2">
              {[
                { val: "", label: "All Prices" },
                { val: "under-100", label: "Under $100" },
                { val: "100-500", label: "$100 - $500" },
                { val: "500-plus", label: "$500+" },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => {
                    setFilters({ ...filters, priceRange: opt.val });
                    setShowPriceDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 type-nav text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between"
                >
                  <span>{opt.label}</span>
                  {filters.priceRange === opt.val && (
                    <i className="bi bi-check text-blue-600"></i>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Condition Filter */}
        <div className="relative">
          <button
            onClick={() => setShowConditionDropdown(!showConditionDropdown)}
            className={`flex items-center gap-1 bg-gray-100 border border-gray-200 rounded px-3 py-1.5 type-nav hover:bg-gray-200
              ${
                filters.condition
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "text-gray-700"
              }`}
          >
            <span className="font-medium whitespace-nowrap">
              {getConditionLabel()}
            </span>
            <i
              className={`bi bi-chevron-down text-xs transition-transform ${showConditionDropdown ? "rotate-180" : ""}`}
            ></i>
          </button>

          {showConditionDropdown && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-2">
              {[
                { val: "", label: "All Conditions" },
                { val: "new", label: "New" },
                { val: "used", label: "Used" },
                { val: "refurbished", label: "Refurbished" },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => {
                    setFilters({ ...filters, condition: opt.val });
                    setShowConditionDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 type-nav text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between"
                >
                  <span>{opt.label}</span>
                  {filters.condition === opt.val && (
                    <i className="bi bi-check text-blue-600"></i>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* More Filters Button */}
        <button
          onClick={handleMoreFilters}
          className="ml-auto flex items-center gap-1 bg-gray-100 border border-gray-200 rounded px-3 py-1.5 type-nav hover:bg-gray-200 text-gray-700"
        >
          <i className="bi bi-funnel text-sm"></i>
          <span className="font-medium whitespace-nowrap">More Filters</span>
        </button>
      </div>
    </div>
  );
}
