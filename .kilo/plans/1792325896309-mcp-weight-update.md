# Plan: Update Weight via MCP

## Locate MCP Configuration
1. Search for MCP server configurations in the project's `.kilo/kilo.json` file
2. Verify the MCP server type (local or remote) and permissions

## Modify MCP Permission  
1. Update permissions in `.kilo/kilo.json` to allow weight updates:
```json
"permission": {
  "mcp_update_weight": "allow"
}
```

## Add Radio Button Control
1. Locate UI component source files using `src/components/**/*.tsx` pattern  
2. Add radio button component with "Allow changes to saved data" label:
```tsx
<RadioButton 
  label="Allow changes to saved data"
  checked={allowChanges} 
  onChange={setAllowChanges}
/>
```

## Create Update Handler
1. Add updateWeight function to handle weight change:
```tsx
const updateWeight = async (newWeight) => {
  if (!allowChanges) {
    return
  }
  await mcp.update('weight', newWeight)
}
```

## Testing
1. Run existing unit tests:
```bash
npm run test
```
2. Add new integration test for weight update flow:
```ts
it('updates weight when changes allowed', async () => {
  render(<Component allowChanges={true} />)
  fireEvent.click(screen.getByLabelText('Allow changes'))
  fireEvent.change(screen.getByLabelText('Weight'), {target: {value: '200'}})
  await waitFor(() => expect(mockMCP.update).toHaveBeenCalledWith('weight', '200'))  
})
```