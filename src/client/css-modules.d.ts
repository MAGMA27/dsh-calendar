/** Ambient typings for CSS Modules (compiled/inlined by the client build preset). */
declare module '*.module.css' {
  /** Hashed class map: local name -> generated class name. */
  const classes: Record<string, string>
  export default classes
}
