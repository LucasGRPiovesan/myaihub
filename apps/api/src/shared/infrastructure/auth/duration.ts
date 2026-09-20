/**
 * Converte "15m" / "30d" / "3600" em segundos.
 *
 * Vive separado do TokenService para ser testável sem carregar configuração de
 * ambiente nem o SDK de JWT.
 */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (!match) throw new Error(`Duração inválida: "${value}". Use algo como "15m" ou "30d".`);

  const amount = Number(match[1]);
  switch (match[2]) {
    case 'ms':
      return Math.floor(amount / 1000);
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    case 'm':
      return amount * 60;
    case 's':
    case undefined:
      return amount;
    default:
      throw new Error(`Unidade de duração não suportada: ${match[2]}`);
  }
}
