import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, Field, Input } from './primitives';

describe('Button', () => {
  it('desabilita e anuncia estado ocupado enquanto carrega', () => {
    render(<Button loading>Salvar</Button>);
    const button = screen.getByRole('button', { name: /salvar/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('não anuncia aria-busy quando não está carregando', () => {
    render(<Button>Salvar</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });
});

describe('Field', () => {
  it('associa o label ao controle', () => {
    render(
      <Field label="E-mail" htmlFor="email">
        <Input id="email" />
      </Field>,
    );
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
  });

  it('anuncia o erro como alerta e esconde o hint', () => {
    render(
      <Field
        label="E-mail"
        htmlFor="email"
        error="E-mail inválido."
        hint="Use seu e-mail de trabalho."
      >
        <Input id="email" invalid />
      </Field>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('E-mail inválido.');
    expect(screen.queryByText('Use seu e-mail de trabalho.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
  });
});
