"use client";

import { useState } from "react";

interface Filters {
  search: string;
  province: string;
  district: string;
  commune: string;
  sort: string;
  price: number;
  salary: number;
  minPrice: string;
  maxPrice: string;
  priceRange: string;
  year: string;
  condition: string;
  engine: string;
  salaryRange: string;
}

export default function LSSHeader({ title }: { title: string }) {
  const [filters, setFilters] = useState<Filters>({
    search: "",
    province: "",
    district: "",
    commune: "",
    sort: "latest",
    price: 0,
    salary: 0,
    minPrice: "",
    maxPrice: "",
    priceRange: "",
    salaryRange: "",
    year: "",
    condition: "",
    engine: "",
  });

  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showSalaryDropdown, setShowSalaryDropdown] = useState(false);
  const [, setShowFilters] = useState(false);

  // Helper to format province display name
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

  const getSalaryLabel = () => {
    if (!filters.priceRange) return "Salary";
    switch (filters.priceRange) {
      case "under-100":
        return "Under $100";
      case "100-500":
        return "$100-$500";
      case "500-plus":
        return "$500+";
      default:
        return "Salary";
    }
  };

  return (
    <div className="bg-white border-b border-gray-200 px-1 py-1 md:px-2 md:py-1 select-none">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="type-page-title">
          {title} <span>in Cambodia</span>
        </h1>

        {/* Right Icons */}
        <div className="flex gap-2">{/* 💰 Price Icon */}</div>
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
            onClick={() => setShowSalaryDropdown(!showSalaryDropdown)}
            className={`flex items-center gap-1 bg-gray-100 border border-gray-200 rounded px-3 py-1.5 type-nav hover:bg-gray-200
              ${
                filters.priceRange
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "text-gray-700"
              }`}
          >
            <span className="font-medium whitespace-nowrap">
              {getSalaryLabel()}
            </span>
            <i
              className={`bi bi-chevron-down text-xs transition-transform ${showSalaryDropdown ? "rotate-180" : ""}`}
            ></i>
          </button>

          {showSalaryDropdown && (
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
                    setFilters({ ...filters, salaryRange: opt.val });
                    setShowSalaryDropdown(false);
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

        {/* More Filters Button */}
        <button
          onClick={() => setShowFilters(true)}
          className="ml-auto flex items-center gap-1 bg-gray-100 border border-gray-200 rounded px-3 py-1.5 type-nav hover:bg-gray-200 text-gray-700"
        >
          <i className="bi bi-funnel text-sm"></i>
          <span className="font-medium whitespace-nowrap">More Filters</span>
        </button>
      </div>

      {/* MODAL */}
      {/* {showFilters && (
        <FiltersModal
          filters={filters}
          setFilters={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )} */}
    </div>
  );
}
