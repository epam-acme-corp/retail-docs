import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://epam-acme-corp.github.io",
  base: "/retail-docs",
  integrations: [
    starlight({
      title: "Acme Retail Docs",
      components: {
        ThemeSelect: './src/components/ThemeSelectWithOPCO.astro',
      },
      sidebar: [
        {
          label: "Overview",
          items: [{ label: "Business Overview", slug: "overview" }],
        },
        {
          label: "Architecture",
          items: [
            { label: "Architecture Overview", slug: "architecture/overview" },
            {
              label: "ADRs",
              items: [
                {
                  label: "ADR-001 Microservices Extraction",
                  slug: "architecture/adr/adr-001-microservices-extraction",
                },
                {
                  label: "ADR-002 Event-Driven Inventory",
                  slug: "architecture/adr/adr-002-event-driven-inventory",
                },
                {
                  label: "ADR-003 .NET 8 Modernization",
                  slug: "architecture/adr/adr-003-dotnet8-modernization",
                },
              ],
            },
          ],
        },
        {
          label: "Technical",
          items: [
            {
              label: "System Landscape",
              slug: "technical/system-landscape",
            },
            {
              label: "BookStore eCommerce Platform",
              slug: "technical/bookstore-ecommerce",
            },
            {
              label: "BookStore Modernization",
              slug: "technical/bookstore-modernization",
            },
            {
              label: "Product Catalogue",
              slug: "technical/product-catalogue",
            },
            {
              label: "Inventory Management",
              slug: "technical/inventory-management",
            },
            {
              label: "Order Fulfillment",
              slug: "technical/order-fulfillment",
            },
            {
              label: "Loyalty Platform",
              slug: "technical/loyalty-platform",
            },
            { label: "Payment Module", slug: "technical/payment-module" },
            {
              label: "Recommendation Engine",
              slug: "technical/recommendation-engine",
            },
          ],
        },
        {
          label: "API",
          items: [
            { label: "API Landscape Overview", slug: "api/overview" },
            { label: "BookStore API Contract", slug: "api/bookstore-api" },
            { label: "Event Schemas", slug: "api/event-schemas" },
          ],
        },
        {
          label: "Data",
          items: [
            { label: "Data Architecture", slug: "data/architecture" },
          ],
        },
        {
          label: "Security",
          items: [
            {
              label: "PCI-DSS Compliance",
              slug: "security/pci-dss-compliance",
            },
          ],
        },
      ],
    }),
  ],
});
