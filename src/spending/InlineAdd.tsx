import { useState, type FormEvent } from "react";

type InlineAddProps = {
  placeholder: string;
  onAdd: (text: string) => void;
};

// A small "type a name, press Enter" field that sits at the end of a row, for adding to that row.
function InlineAdd({ placeholder, onAdd }: InlineAddProps) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed) {
      onAdd(trimmed);
      setText("");
    }
  };
  return (
    <form className="inline-add" onSubmit={submit}>
      <input
        type="text"
        className="inline-add__input"
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </form>
  );
}

export default InlineAdd;
