(async () => {
  const open = (await import('open')).default;
  console.log(typeof open);
})();
