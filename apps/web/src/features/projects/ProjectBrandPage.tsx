import {
  BRAND_SHAPE_LABELS,
  BRAND_SHAPE_RADIUS,
  BRAND_SHAPES,
  BRAND_VOICE_TONE_LABELS,
  BRAND_VOICE_TONES,
  brandCssVariables,
  defaultBrandIdentity,
  FONT_SOURCES,
  type BrandShape,
  type BrandVoiceTone,
  type FontSource,
} from '@myaihub/shared';
import { Info, Sparkles } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router';
import { SkeletonText } from '../../design-system/feedback';
import { Button, Card, Field, Input, cx } from '../../design-system/primitives';
import { useHub } from '../hub/HubProvider';
import { useBrandFont } from './brand-font';
import { useBrandIdentity, useSaveBrandIdentity } from './project-assets.api';
import { useProject } from './projects.api';

/**
 * A identidade que o público vê (Fase 5).
 *
 * Formulário, não conversa — mesma divisão do resto do sistema: o painel serve
 * a INTENÇÃO ("quero algo mais sóbrio"), a tela serve a CORREÇÃO (digitar um
 * hexadecimal que a pessoa já tem na mão). Mandar uma cor para o modelo gastaria
 * tokens para reproduzir o que ela acabou de escrever, e às vezes errado.
 *
 * A PRÉVIA existe porque este é o único documento do sistema cujo efeito é
 * visual: descrever "#1f6feb sobre #ffffff" em texto não responde à pergunta
 * que o usuário está fazendo, que é "isto fica legível?".
 */
/**
 * Um campo de cor: o seletor nativo e o hexadecimal, lado a lado.
 *
 * Existe porque a paleta passou de duas cores para sete, e sete repetições do
 * mesmo par de inputs no JSX é onde nasce a divergência — uma delas fica sem o
 * `min-w-0 flex-1` e a caixa de texto espreme até uma letra por linha, que é um
 * defeito que esta tela já teve.
 */
function ColorField({
  label,
  id,
  hint,
  value,
  onChange,
}: {
  label: string;
  id: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Escolher ${label.toLowerCase()}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-border bg-surface"
        />
        {/* Sem largura na base, com `min-w-0 flex-1`: `w-full` e uma largura
            fixa na mesma classe é conflito de Tailwind, e quem vence é a ordem
            da folha — não a da string. */}
        <Input
          id={id}
          value={value}
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1"
        />
      </div>
    </Field>
  );
}

export function ProjectBrandPage() {
  const { projectId } = useParams();
  const { data: project } = useProject(projectId);
  const { data: brand, isPending, isError } = useBrandIdentity(projectId);
  const save = useSaveBrandIdentity(projectId);
  const { open } = useHub();

  const [displayName, setDisplayName] = useState('');
  const [tagline, setTagline] = useState('');
  const [primary, setPrimary] = useState('#1f6feb');
  const [onPrimary, setOnPrimary] = useState('#ffffff');
  // A paleta INTEIRA, porque a página pública se desenha inteira com ela — não
  // só a faixa do topo. Ver `brandCssVariables`.
  const [canvas, setCanvas] = useState('#f7f8fb');
  const [surface, setSurface] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#0d111b');
  const [textMuted, setTextMuted] = useState('#5a6478');
  const [border, setBorder] = useState('#e3e7ef');
  // Psicologia da cor DENTRO da marca: um comparativo publicado precisa das
  // duas para marcar vantagem/desvantagem sem sair da paleta aprovada.
  const [success, setSuccess] = useState('#2c7a4b');
  const [danger, setDanger] = useState('#a3311a');
  const [headingFamily, setHeadingFamily] = useState('');
  const [bodyFamily, setBodyFamily] = useState('');
  const [fontSource, setFontSource] = useState<FontSource>('SYSTEM');
  const [shape, setShape] = useState<BrandShape>('SOFT');
  const [tone, setTone] = useState<BrandVoiceTone>('NEUTRO');
  const [guidance, setGuidance] = useState('');
  const [avoid, setAvoid] = useState('');
  const [legalFooter, setLegalFooter] = useState('');

  // A fonte do RASCUNHO, não a da versão salva: a prévia responde sobre o que
  // está no formulário. Sem carregá-la, ela anunciaria a tipografia e mostraria
  // a pilha nativa — mentindo sobre o campo que a pessoa acabou de preencher.
  useBrandFont({
    ...(brand?.canonical ?? defaultBrandIdentity('')),
    typography: { headingFamily, bodyFamily, source: fontSource },
  });

  // Recarrega o formulário quando a VERSÃO muda — inclusive quando quem mudou
  // foi o OS, pelo painel. Sem isto a tela seguiria mostrando o rascunho antigo
  // e o próximo "salvar" desfaria o que o OS acabou de fazer.
  //
  // A dependência é a versão, NUNCA o objeto: o TanStack devolve um objeto
  // novo a cada refetch, e com ele nas dependências o efeito rodava a cada
  // volta da query — apagando o que a pessoa estava digitando no meio.
  useEffect(() => {
    if (!brand) return;
    setDisplayName(brand.canonical.displayName);
    setTagline(brand.canonical.tagline);
    setPrimary(brand.canonical.colors.primary);
    setOnPrimary(brand.canonical.colors.onPrimary);
    setCanvas(brand.canonical.colors.canvas);
    setSurface(brand.canonical.colors.surface);
    setTextColor(brand.canonical.colors.text);
    setTextMuted(brand.canonical.colors.textMuted);
    setBorder(brand.canonical.colors.border);
    setSuccess(brand.canonical.colors.success);
    setDanger(brand.canonical.colors.danger);
    setHeadingFamily(brand.canonical.typography.headingFamily);
    setBodyFamily(brand.canonical.typography.bodyFamily);
    setFontSource(brand.canonical.typography.source);
    setShape(brand.canonical.shape);
    setTone(brand.canonical.voice.tone);
    setGuidance(brand.canonical.voice.guidance);
    setAvoid(brand.canonical.voice.avoid.join(', '));
    setLegalFooter(brand.canonical.legalFooter);
  }, [brand?.versionNumber]);

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={6} />
      </div>
    );
  }

  if (isError || !brand) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Não foi possível carregar a identidade.
          </p>
        </Card>
      </div>
    );
  }

  const nomeExibido = displayName || project?.name || 'Sua marca';

  // O MESMO tema que a página pública monta, a partir do que está no formulário
  // (e não do que está salvo): a prévia tem que responder sobre o rascunho.
  const previa = brandCssVariables({
    ...brand.canonical,
    colors: {
      primary,
      onPrimary,
      canvas,
      surface,
      text: textColor,
      textMuted,
      border,
      success,
      danger,
    },
    typography: { headingFamily, bodyFamily, source: fontSource },
    shape,
  }) as CSSProperties;

  function salvar() {
    save.mutate({
      changes: {
        displayName,
        tagline,
        primaryColor: primary,
        onPrimaryColor: onPrimary,
        canvasColor: canvas,
        surfaceColor: surface,
        textColor,
        textMutedColor: textMuted,
        borderColor: border,
        successColor: success,
        dangerColor: danger,
        headingFamily,
        bodyFamily,
        fontSource,
        shape,
        tone,
        voiceGuidance: guidance,
        avoid: avoid
          .split(',')
          .map((palavra) => palavra.trim())
          .filter(Boolean),
        legalFooter,
      },
      reason: 'Ajuste manual da identidade de marca',
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">Identidade</h1>
          <p className="mt-1 truncate text-sm text-text-muted">
            {project?.name}
            {brand.versionNumber > 0 ? ` · v${brand.versionNumber}` : ' · ainda no padrão'}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={open}>
          <Sparkles aria-hidden className="size-4" />
          Ajustar
        </Button>
      </div>

      <Card className="mt-4 flex items-start gap-3 p-4">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-text-subtle" />
        <p className="text-[13px] leading-relaxed text-text-muted">
          O <strong className="font-medium text-text">tom de voz</strong> não é enfeite: ele entra
          no prompt de todo agente que atua neste projeto e muda como eles escrevem. Cor, logo e
          rodapé ficam na página pública. Campanha já publicada só recebe estes ajustes na próxima
          publicação.
        </p>
      </Card>

      {/*
        A PRÉVIA MOSTRA O ATENDIMENTO, não uma faixa colorida.

        Antes ela pintava só o cabeçalho — e era honesta enquanto a página
        pública também só pintava o cabeçalho. Agora que a página inteira veste
        a marca, uma prévia do topo esconderia justamente o que passou a
        depender destes campos: o fundo, o balão, a linha, a fonte.

        Usa a MESMA função que a página pública (`brandCssVariables`): duas
        montagens do tema divergiriam, e a prévia passaria a mentir.
      */}
      <div
        className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-border"
        style={previa}
      >
        <div
          className="px-4 py-3"
          style={{ backgroundColor: primary, color: onPrimary, fontFamily: 'var(--font-heading)' }}
        >
          <p className="text-[15px] font-semibold">{nomeExibido}</p>
          {tagline && <p className="text-[13px] opacity-80">{tagline}</p>}
        </div>

        <div
          className="flex flex-col gap-2.5 px-4 py-4"
          style={{ backgroundColor: canvas, fontFamily: 'var(--font-sans)' }}
        >
          <p className="text-sm leading-relaxed" style={{ color: textColor }}>
            Posso te ajudar a escolher. Para começar:
          </p>

          <div
            className="overflow-hidden border"
            style={{
              backgroundColor: surface,
              borderColor: border,
              borderRadius: 'var(--radius-card)',
            }}
          >
            <p
              className="border-b px-3 py-1.5 text-[12px] font-semibold"
              style={{ borderColor: border, color: textColor }}
            >
              Como funciona
            </p>
            <div className="flex items-center gap-2.5 px-3 py-2">
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ backgroundColor: primary, color: onPrimary }}
              >
                1
              </span>
              <span className="text-[12px]" style={{ color: textMuted }}>
                Você conta o que precisa
              </span>
            </div>
          </div>

          <p
            className="ml-auto max-w-[75%] px-3 py-1.5 text-[13px]"
            style={{
              backgroundColor: primary,
              color: onPrimary,
              borderRadius: 'var(--radius-card)',
            }}
          >
            Preciso de um orçamento
          </p>
        </div>
      </div>
      <p className="mt-1.5 text-[13px] text-text-subtle">
        Prévia da página de atendimento, com as cores, a fonte e a forma desta identidade.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        <Field label="Nome exibido" htmlFor="brand-name" hint="Vazio = o nome do projeto.">
          <Input
            id="brand-name"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>

        <Field
          label="Tagline"
          htmlFor="brand-tagline"
          hint="O que o negócio faz — não um slogan vago."
        >
          <Input
            id="brand-tagline"
            value={tagline}
            maxLength={160}
            onChange={(event) => setTagline(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cor principal" htmlFor="brand-primary">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Escolher cor principal"
                value={primary}
                onChange={(event) => setPrimary(event.target.value)}
                className="size-9 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-border bg-surface"
              />
              {/* Sem largura na base, com `min-w-0 flex-1`: `w-full` e uma
                  largura fixa na mesma classe é conflito de Tailwind, e quem
                  vence é a ordem da folha — não a da string. */}
              <Input
                id="brand-primary"
                value={primary}
                maxLength={7}
                onChange={(event) => setPrimary(event.target.value)}
                className="min-w-0 flex-1"
              />
            </div>
          </Field>

          <Field label="Cor do texto" htmlFor="brand-on-primary" hint="Sobre a cor principal.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Escolher cor do texto"
                value={onPrimary}
                onChange={(event) => setOnPrimary(event.target.value)}
                className="size-9 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-border bg-surface"
              />
              <Input
                id="brand-on-primary"
                value={onPrimary}
                maxLength={7}
                onChange={(event) => setOnPrimary(event.target.value)}
                className="min-w-0 flex-1"
              />
            </div>
          </Field>
        </div>

        {/*
          O RESTO DA PALETA. Não é refinamento: sem estes campos a página
          pública não tinha como ser a do cliente — ela caía nos tokens do
          MyAIHub para tudo que não fosse o cabeçalho.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField
            label="Fundo da página"
            id="brand-canvas"
            value={canvas}
            onChange={setCanvas}
          />
          <ColorField
            label="Superfície"
            id="brand-surface"
            hint="Cartões e campo de texto."
            value={surface}
            onChange={setSurface}
          />
          <ColorField
            label="Texto"
            id="brand-text"
            hint="Sobre a superfície."
            value={textColor}
            onChange={setTextColor}
          />
          <ColorField
            label="Texto secundário"
            id="brand-text-muted"
            hint="Legenda e rodapé."
            value={textMuted}
            onChange={setTextMuted}
          />
          <ColorField label="Linha" id="brand-border" value={border} onChange={setBorder} />
        </div>

        {/*
          Vantagem/desvantagem são cores DECLARADAS pelo cliente, não calculadas
          a partir da primária: um verde puxado de um azul sai dessaturado
          demais para funcionar como sinal, e psicologia da cor não pode
          depender de sorte.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField
            label="Vantagem"
            id="brand-success"
            hint="Ponto favorável num comparativo."
            value={success}
            onChange={setSuccess}
          />
          <ColorField
            label="Desvantagem"
            id="brand-danger"
            hint="Ponto desfavorável num comparativo."
            value={danger}
            onChange={setDanger}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Fonte dos títulos"
            htmlFor="brand-heading-font"
            hint="Só o nome da família. Vazio = fonte do dispositivo."
          >
            <Input
              id="brand-heading-font"
              value={headingFamily}
              maxLength={48}
              placeholder="Poppins"
              onChange={(event) => setHeadingFamily(event.target.value)}
            />
          </Field>

          <Field label="Fonte do texto" htmlFor="brand-body-font">
            <Input
              id="brand-body-font"
              value={bodyFamily}
              maxLength={48}
              placeholder="Inter"
              onChange={(event) => setBodyFamily(event.target.value)}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-text">De onde vem a fonte</legend>
          <div className="flex flex-wrap gap-2">
            {FONT_SOURCES.map((opcao) => (
              <label
                key={opcao}
                className={cx(
                  'cursor-pointer rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px]',
                  fontSource === opcao
                    ? 'border-border-strong bg-surface-sunken text-text'
                    : 'border-border text-text-muted',
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={fontSource === opcao}
                  onChange={() => setFontSource(opcao)}
                />
                {opcao === 'GOOGLE' ? 'Google Fonts' : 'Fonte do dispositivo'}
              </label>
            ))}
          </div>
          <p className="text-[13px] text-text-subtle">
            Com Google Fonts, a página de atendimento baixa a família. Use a fonte do dispositivo
            para Arial, Helvetica e afins — elas já existem em quem visita.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-text">Forma</legend>
          <div className="flex flex-wrap gap-2">
            {BRAND_SHAPES.map((opcao) => (
              <label
                key={opcao}
                className={cx(
                  'flex cursor-pointer items-center gap-2 border px-3 py-1.5 text-[13px]',
                  shape === opcao
                    ? 'border-border-strong bg-surface-sunken text-text'
                    : 'border-border text-text-muted',
                )}
                style={{ borderRadius: BRAND_SHAPE_RADIUS[opcao] }}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={shape === opcao}
                  onChange={() => setShape(opcao)}
                />
                {BRAND_SHAPE_LABELS[opcao]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-text">Tom de voz</legend>
          <div className="flex flex-wrap gap-2">
            {BRAND_VOICE_TONES.map((opcao) => (
              <label
                key={opcao}
                className={cx(
                  'cursor-pointer rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px]',
                  tone === opcao
                    ? 'border-border-strong bg-surface-sunken text-text'
                    : 'border-border text-text-muted',
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={tone === opcao}
                  onChange={() => setTone(opcao)}
                />
                {BRAND_VOICE_TONE_LABELS[opcao]}
              </label>
            ))}
          </div>
        </fieldset>

        <Field
          label="Orientação de voz"
          htmlFor="brand-guidance"
          hint="Quando o tom não basta. Entra no prompt como está."
        >
          <textarea
            id="brand-guidance"
            value={guidance}
            maxLength={600}
            rows={3}
            onChange={(event) => setGuidance(event.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
          />
        </Field>

        <Field
          label="Palavras que a marca não usa"
          htmlFor="brand-avoid"
          hint="Separadas por vírgula. Nomear o que não se usa é o que faz a regra funcionar."
        >
          <Input
            id="brand-avoid"
            value={avoid}
            onChange={(event) => setAvoid(event.target.value)}
            placeholder="imperdível, promoção relâmpago"
          />
        </Field>

        <Field
          label="Rodapé legal"
          htmlFor="brand-legal"
          hint="CNPJ, política, aviso de que o atendimento é feito por IA."
        >
          <textarea
            id="brand-legal"
            value={legalFooter}
            maxLength={400}
            rows={2}
            onChange={(event) => setLegalFooter(event.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button onClick={salvar} loading={save.isPending}>
            Salvar identidade
          </Button>
          {save.isSuccess && !save.isPending && (
            <span className="text-[13px] text-text-muted">Salvo como versão nova.</span>
          )}
          {save.isError && (
            <span role="alert" className="text-[13px] text-danger">
              {save.error.message}
            </span>
          )}
        </div>

        {brand.gaps.length > 0 && (
          <Card className="p-4">
            <p className="text-[13px] font-medium text-text">O que ainda falta</p>
            <ul className="mt-2 flex flex-col gap-1">
              {brand.gaps.map((gap) => (
                <li key={gap} className="text-[13px] text-text-muted">
                  {gap}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
