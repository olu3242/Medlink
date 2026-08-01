"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
export interface CarouselSlide { title: string; subtitle: string; description: string; image: string; alt: string; }
export function Carousel({ slides }: { slides: CarouselSlide[] }) {
  const [active, setActive] = useState(0); const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused) return; const timer = setInterval(() => setActive((value) => (value + 1) % slides.length), 5000); return () => clearInterval(timer); }, [paused, slides.length]);
  const slide = slides[active] ?? slides[0]; if (!slide) return null;
  return <div className="carousel" aria-roledescription="carousel" aria-label="MedLink care journey" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}><div className="carousel__image"><Image key={slide.image} src={slide.image} alt={slide.alt} fill priority={active === 0} sizes="(max-width: 1024px) 100vw, 50vw" /><div className="carousel__caption"><small>{slide.subtitle}</small><h2>{slide.title}</h2><p>{slide.description}</p></div></div><div className="carousel__controls"><div>{slides.map((item, index) => <button key={item.title} className={index === active ? "active" : ""} onClick={() => setActive(index)} aria-label={`Show slide ${index + 1}`} aria-current={index === active} />)}</div><div><button onClick={() => setActive((active - 1 + slides.length) % slides.length)} aria-label="Previous slide">←</button><button onClick={() => setActive((active + 1) % slides.length)} aria-label="Next slide">→</button></div></div></div>;
}
