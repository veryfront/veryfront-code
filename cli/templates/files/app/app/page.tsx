import { FeatureGrid } from "../components/FeatureGrid.tsx";
import { Header } from "../components/Header.tsx";
import { HeroSection } from "../components/HeroSection.tsx";

export default function HomePage(): JSX.Element {
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
