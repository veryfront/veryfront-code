---
isLayout: true
previewProps:
  children: <page rendered here>
---

import Footer from "@components/layouts/FooterSlim"
import { Header } from "@components/layouts/HeaderSlim"

<div className="flex flex-col min-h-[100dvh]">
  <Header />

  <div className="flex flex-col flex-1 w-full justify-center">
    {props.children}
  </div>

  <Footer />
</div> 
