import { Header } from "../components/Header.tsx";
import { HeroSection } from "../components/HeroSection.tsx";
import { FeatureGrid } from "../components/FeatureGrid.tsx";

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <HeroSection />
        <FeatureGrid />
      </main>
    </>
  );
}